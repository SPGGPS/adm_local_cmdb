from datetime import date, datetime, timezone, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.middleware.auth import require_viewer
from sqlalchemy import or_
from app.models.asset import Asset, AssetType
from app.models.certificate import Certificate
from app.models.application import Service
from app.models.exception import ComplianceException, ComplianceIndicator

# Agente considerado online si contactó EDR en las últimas N horas.
# Debe ser >= ciclo del DAG (4h) + margen de check-in del agente (~30 min).
_ONLINE_THRESHOLD = timedelta(hours=4, minutes=30)

router = APIRouter(tags=["Dashboard"])

TYPE_LABELS = {
    "server_physical": "Servidores físicos",
    "server_virtual":  "Servidores virtuales",
    "switch":          "Switches",
    "router":          "Routers",
    "ap":              "Puntos de acceso",
    "database":        "Bases de datos",
    "k8s_cluster":     "Clusters K8s",
    "container":       "Contenedores",
    "web_server":      "Servidores web",
    "firewall":        "Firewalls",
    "load_balancer":   "Balanceadores",
    "storage_array":   "Almacenamiento",
    "vcenter":         "vCenters",
}
INDICATOR_LABELS = {
    "edr":   "EDR",
    "siem":  "SIEM",
    "mon":   "Monitorización",
    "logs":  "Logs",
    "bck":   "Backup Local",
    "bckcl": "Backup Cloud",
}

def _asset_info(a):
    return {"id": a.id, "name": a.name, "type": str(a.type).split(".")[-1] if a.type else None}

def _get_compliance_state(asset, indicator: str, active_exc_map: dict) -> str:
    ok_map = {
        "edr":   bool(asset.edr_installed),
        "mon":   bool(asset.monitored),
        "siem":  bool(asset.siem_enabled),
        "logs":  bool(asset.logs_enabled),
        "bck":   bool(asset.last_backup_local),
        "bckcl": bool(asset.last_backup_cloud),
    }
    is_ok  = ok_map.get(indicator, False)
    has_exc = indicator in active_exc_map.get(asset.id, set())
    if is_ok and has_exc: return "ok_with_exception"
    if is_ok:             return "ok"
    if has_exc:           return "ko_with_exception"
    return "ko"

@router.get("/v1/dashboard")
def get_dashboard(db: Session = Depends(get_db), user=Depends(require_viewer)):
    assets = db.query(Asset).filter(or_(Asset.needs_review == None, Asset.needs_review == False)).all()  
    certs  = db.query(Certificate).all()
    now    = date.today()
    now_utc = datetime.now(timezone.utc)

    def _is_edr_online(a) -> bool | None:
        if a.edr_last_seen is None:
            return None
        ls = a.edr_last_seen
        if ls.tzinfo is None:
            ls = ls.replace(tzinfo=timezone.utc)
        return (now_utc - ls) < _ONLINE_THRESHOLD

    # Build active exception map: {asset_id: {indicator_value, ...}}
    active_exc_map: dict = {}
    for exc in db.query(ComplianceException).all():
        if exc.is_active:
            ind = str(exc.indicator).split(".")[-1]
            active_exc_map.setdefault(exc.asset_id, set()).add(ind)

    # KPIs
    active_exceptions = sum(
        1 for exc in db.query(ComplianceException).all() if exc.is_active
    )
    kpis = {
        "total_assets":       len(assets),
        "active_exceptions":  active_exceptions,
        "total_certificates": len(certs),
        "critical_certs":     sum(1 for c in certs if getattr(c, 'cert_status', '') in ('critical','expired')),
        "total_services":     len(db.query(Service).all()),
        "k8s_clusters":       sum(1 for a in assets if str(a.type).split(".")[-1] == "k8s_cluster"),
        "containers":         sum(1 for a in assets if str(a.type).split(".")[-1] == "container"),
    }

    # EOL by type
    EOL_TAG_MAP = {"EOL KO": "eol_ko", "EOL WARN": "eol_warn", "EOL OK": "eol_ok"}
    eol_by_type = []
    for at in AssetType:
        type_key = str(at).split(".")[-1]
        group_assets = [a for a in assets if str(a.type).split(".")[-1] == type_key]
        if not group_assets:
            continue
        seg = {"eol_ko": [], "eol_warn": [], "eol_ok": [], "no_data": []}
        for a in group_assets:
            tag_names = {t.name for t in (a.tags or [])}
            matched = False
            for tag_name, seg_key in EOL_TAG_MAP.items():
                if tag_name in tag_names:
                    seg[seg_key].append(_asset_info(a))
                    matched = True
                    break
            if not matched:
                seg["no_data"].append(_asset_info(a))
        # Solo incluir segmentos EOL que tengan al menos 1 elemento
        eol_segments = []
        eol_map = [
            ("eol_ko",   "EOL KO",    "#dc2626"),
            ("eol_warn", "EOL WARN",  "#d97706"),
            ("eol_ok",   "EOL OK",    "#16a34a"),
            ("no_data",  "Sin datos EOL", "#94a3b8"),
        ]
        for status, label, color in eol_map:
            items = seg[status]
            if items:  # solo si hay elementos
                eol_segments.append({"status": status, "label": label,
                                     "count": len(items), "color": color, "items": items})
        if eol_segments:  # solo añadir el grupo si tiene al menos un segmento
            eol_by_type.append({
                "type": type_key,
                "label": TYPE_LABELS.get(type_key, type_key),
                "total": len(group_assets),
                "segments": eol_segments
            })

    # Compliance
    compliance = []
    COMP_COLORS = {
        "ok":                "#16a34a",  # verde — cumple sin excepciones
        "ok_with_exception": "#0891b2",  # cian — cumple + excepción activa (degradado azul→verde)
        "ko_with_exception": "#d97706",  # ámbar — no cumple + excepción justificada (degradado azul→rojo)
        "ko":                "#dc2626",  # rojo — no cumple sin justificación
    }
    COMP_LABELS = {
        "ok": "Activo", "ok_with_exception": "OK + excepción",
        "ko_with_exception": "KO + excepción", "ko": "Sin cumplir",
    }
    for ind in ["edr","siem","mon","logs","bck","bckcl"]:
        seg = {"ok": [], "ok_with_exception": [], "ko_with_exception": [], "ko": []}
        for a in assets:
            state = _get_compliance_state(a, ind, active_exc_map)
            seg[state].append(_asset_info(a))
        # Solo añadir segmentos con elementos
        comp_segs = [
            {"status": st, "label": COMP_LABELS[st], "count": len(items),
             "color": COMP_COLORS[st], "items": items}
            for st, items in seg.items() if items
        ]
        compliance.append({
            "indicator": ind,
            "label": INDICATOR_LABELS[ind],
            "segments": comp_segs
        })

    # Backup
    def backup_seg(field_fn, label):
        ok, missing = [], []
        for a in assets:
            (ok if field_fn(a) else missing).append(_asset_info(a))
        return {
            "label": label,
            "segments": [s for s in [
                {"status":"ok",      "label":"Con backup",  "count":len(ok),      "color":"#16a34a","items":ok},
                {"status":"missing", "label":"Sin backup",  "count":len(missing), "color":"#dc2626","items":missing},
            ] if s["count"]]
        }
    backup = {
        "local":  backup_seg(lambda a: bool(a.last_backup_local),  "Backup Local"),
        "cloud":  backup_seg(lambda a: bool(a.last_backup_cloud),  "Backup Cloud"),
    }

    # Certificates
    cert_seg = {"valid":[],"expiring":[],"critical":[],"expired":[]}
    CERT_COLORS = {"valid":"#16a34a","expiring":"#d97706","critical":"#f97316","expired":"#dc2626"}
    CERT_LABELS = {"valid":"Válidos","expiring":"Próximos (≤30d)","critical":"Críticos (≤7d)","expired":"Expirados"}
    for c in certs:
        st = getattr(c, 'cert_status', 'unknown')
        if st in cert_seg:
            cert_seg[st].append({"id": c.id, "name": c.common_name})
    certificates = {
        "segments": [
            {"status": st, "label": CERT_LABELS[st], "count": len(items),
             "color": CERT_COLORS[st], "items": items}
            for st, items in cert_seg.items() if items
        ]
    }

    # Services
    services_raw = db.query(Service).all()
    SVC_COLORS = {
        "active":      "#16a34a",   # verde — igual que badge activo
        "degraded":    "#f97316",   # naranja — igual que badge degradado
        "maintenance": "#d97706",   # ámbar — igual que badge mantenimiento
        "inactive":    "#94a3b8",   # gris
    }
    SVC_LABELS = {
        "active": "Activo", "degraded": "Degradado",
        "maintenance": "Mantenimiento", "inactive": "Inactivo",
    }
    svc_status_seg: dict = {"active":[], "degraded":[], "maintenance":[], "inactive":[]}
    for s in services_raw:
        st = str(s.status).split(".")[-1]
        info = {"id": s.id, "name": s.name, "type": SVC_LABELS.get(st, st)}
        svc_status_seg.setdefault(st, []).append(info)

    services = {
        "total": len(services_raw),
        "by_status": {
            "segments": [
                {"status": st, "label": SVC_LABELS.get(st, st), "count": len(items),
                 "color": SVC_COLORS.get(st, "#94a3b8"), "items": items}
                for st, items in svc_status_seg.items()
            ]
        },
        "list": [
            {
                "id": s.id,
                "name": s.name,
                "status": str(s.status).split(".")[-1],
                "criticality": str(s.criticality).split(".")[-1],
                "owner_team": s.owner_team,
                "endpoints_count": len(s.endpoints or []),
            }
            for s in services_raw
        ]
    }

    # EDR Agent Status
    # Solo servidores (físicos y virtuales) tienen agente Agente EDR.
    _SERVER_TYPES = {"server_physical", "server_virtual"}
    edr_assets = [a for a in assets if str(a.type).split(".")[-1] in _SERVER_TYPES]

    # edr_endpoint_id IS NULL → nunca macheó con EDR
    # └ con excepción activa "edr" → "exc"      (ámbar — gestionado sin EDR)
    # └ sin excepción              → "unmatched" (gris — no tiene EDR)
    # edr_endpoint_id IS NOT NULL → tiene registro EDR (con o sin agente)
    def _has_edr_exc(a) -> bool:
        return "edr" in active_exc_map.get(a.id, set())

    def _edr_bool_seg_all(get_val, true_status, false_status, true_label, false_label, true_color, false_color):
        seg = {true_status: [], false_status: [], "no_data": [], "unmatched": [], "exc": []}
        for a in edr_assets:
            if not a.edr_endpoint_id:
                if _has_edr_exc(a):
                    seg["exc"].append(_asset_info(a))
                else:
                    seg["unmatched"].append(_asset_info(a))
            elif not a.edr_installed:
                seg["no_data"].append(_asset_info(a))
            else:
                v = get_val(a)
                if v is True:    seg[true_status].append(_asset_info(a))
                elif v is False: seg[false_status].append(_asset_info(a))
                else:            seg["no_data"].append(_asset_info(a))
        rows = []
        for st, label, color in [
            (true_status,  true_label,          true_color),
            (false_status, false_label,          false_color),
            ("no_data",    "Sin datos",          "#94a3b8"),
            ("exc",        "Sin EDR (excepción)","#d97706"),
            ("unmatched",  "Sin EDR",            "#64748b"),
        ]:
            if seg[st]: rows.append({"status": st, "label": label, "count": len(seg[st]), "color": color, "items": seg[st]})
        return rows

    online_segs  = _edr_bool_seg_all(_is_edr_online,                   "online",    "offline",   "Online",       "Offline",         "#16a34a", "#ef4444")
    tamper_segs  = _edr_bool_seg_all(lambda a: a.edr_tamper_protected, "enabled",   "disabled",  "Activada",     "Desactivada",     "#16a34a", "#ef4444")
    managed_segs = _edr_bool_seg_all(lambda a: a.edr_managed,          "managed",   "unmanaged", "Gestionado",   "No gestionado",   "#16a34a", "#ef4444")

    MODE_COLORS = {"XDR": "#0891b2", "Intercept X": "#7c3aed", "Standard": "#16a34a"}
    mode_seg: dict = {"no_data": [], "unmatched": [], "exc": []}
    for a in edr_assets:
        if not a.edr_endpoint_id:
            if _has_edr_exc(a):
                mode_seg["exc"].append(_asset_info(a))
            else:
                mode_seg["unmatched"].append(_asset_info(a))
        else:
            m = a.edr_agent_mode or "no_data"
            mode_seg.setdefault(m, []).append(_asset_info(a))
    mode_segs = []
    for m, items in sorted(mode_seg.items(), key=lambda x: -len(x[1])):
        if not items: continue
        if m == "unmatched":
            mode_segs.append({"status": "unmatched", "label": "Sin EDR", "count": len(items), "color": "#64748b", "items": items})
        elif m == "exc":
            mode_segs.append({"status": "exc", "label": "Sin EDR (excepción)", "count": len(items), "color": "#d97706", "items": items})
        elif m == "no_data":
            mode_segs.append({"status": "no_data", "label": "Sin datos", "count": len(items), "color": "#94a3b8", "items": items})
        else:
            mode_segs.append({"status": m, "label": m, "count": len(items), "color": MODE_COLORS.get(m, "#64748b"), "items": items})

    edr_installed_count = sum(1 for a in edr_assets if a.edr_installed)

    # Fecha del dato más reciente de EDR en la DB (indica frescura del sync)
    last_sync_at = None
    for a in edr_assets:
        if a.edr_last_seen:
            ls = a.edr_last_seen
            if ls.tzinfo is None:
                ls = ls.replace(tzinfo=timezone.utc)
            if last_sync_at is None or ls > last_sync_at:
                last_sync_at = ls

    edr_agent_status = {
        "total":          len(edr_assets),
        "edr_installed":  edr_installed_count,
        "last_sync_at":   last_sync_at.isoformat() if last_sync_at else None,
        "online":  {"label": "Conectividad",            "segments": online_segs},
        "tamper":  {"label": "Protec. manipulación",    "segments": tamper_segs},
        "mode":    {"label": "Modo agente",             "segments": mode_segs},
        "managed": {"label": "Gestionado",              "segments": managed_segs},
    }

    # EDR Security Health (good/suspicious/bad/unknown/sin EDR)
    # Cubre todos los servidores; para los que no tienen agente → "sin_edr".
    # Valores de EDR: good, suspicious, bad, unknown (campo edr_health).
    _HEALTH_ORDER  = ["good", "suspicious", "bad", "unknown", "sin_edr"]
    _HEALTH_COLORS = {
        "good":       "#16a34a",  # verde  — sin amenazas, todo OK
        "suspicious": "#d97706",  # ámbar  — advertencias / recomendaciones
        "bad":        "#dc2626",  # rojo   — amenazas activas o problemas críticos
        "unknown":    "#94a3b8",  # gris   — en EDR pero estado desconocido
        "sin_edr":    "#64748b",  # slate  — sin agente EDR
    }
    _HEALTH_LABELS = {
        "good":       "Bueno",
        "suspicious": "Advertencia",
        "bad":        "Crítico",
        "unknown":    "Desconocido",
        "sin_edr":    "Sin EDR",
    }
    health_seg: dict[str, list] = {k: [] for k in _HEALTH_ORDER}
    for a in edr_assets:
        if not a.edr_endpoint_id:
            health_seg["sin_edr"].append(_asset_info(a))
        else:
            h = (a.edr_health or "unknown").lower()
            if h not in health_seg:
                h = "unknown"
            health_seg[h].append(_asset_info(a))

    edr_security_health = {
        "label": "Salud de seguridad EDR",
        "total": len(edr_assets),
        "segments": [
            {"status": st, "label": _HEALTH_LABELS[st],
             "count": len(items), "color": _HEALTH_COLORS[st], "items": items}
            for st in _HEALTH_ORDER
            if health_seg[st]
        ],
    }

    return {"kpis": kpis, "eol_by_type": eol_by_type,
            "compliance": compliance, "backup": backup,
            "certificates": certificates, "services": services,
            "edr_agent_status": edr_agent_status,
            "edr_security_health": edr_security_health}
