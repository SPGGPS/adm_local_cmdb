import re as _re
import logging
from sqlalchemy.orm import Session
from app.models.asset import Asset, AssetType
from app.models.tag import Tag, TagOrigin

logger = logging.getLogger("tfg.autotagging")

SYSTEM_TAGS = {
    "Virtual":"#8b5cf6","Physical":"#64748b","Switch":"#0ea5e9",
    "Router":"#f59e0b","Access Point":"#10b981","Database":"#06b6d4",
    "Cisco":"#1d4ed8","VMware":"#607d8b","Dell":"#2196f3","HP":"#0052cc","Juniper":"#43a047",
    "EDR Active":"#16a34a","EDR Missing":"#dc2626",
    "Monitored":"#0284c7","No Monitoring":"#d97706",
    "SIEM Active":"#059669","SIEM Missing":"#b45309",
    "Backup Local OK":"#15803d","Backup Local Missing":"#b91c1c",
    "Backup Cloud OK":"#0369a1","Backup Cloud Missing":"#9f1239",
    # EOL — calculadas por apply_eol_tags cruzando con eol_cycles
    "Kubernetes":"#326CE5","K8s Control Plane":"#1d4ed8","K8s Worker":"#3b82f6",
    "Container":"#0db7ed","Docker":"#0db7ed",
    "EOL KO":"#dc2626","EOL WARN":"#d97706","EOL OK":"#16a34a",
    # Web servers
    "Nginx":"#009639","Apache":"#d22128","IIS":"#0078d4","Tomcat":"#f59e0b",
    "JBoss":"#cc0000","HAProxy":"#4d4d4d","Traefik":"#24a1c1","Varnish":"#4790d4",
    "Envoy":"#ac6199","Caddy":"#22c55e","lighttpd":"#f97316","Jetty":"#003366",
    # Databases
    "PostgreSQL":"#336791","MySQL":"#4479a1","MariaDB":"#c0765a","MSSQL":"#cc2927",
    "Oracle":"#f80000","MongoDB":"#47a248","Redis":"#dc382d","Elasticsearch":"#f4bd19",
    "Cassandra":"#1287b1",
    # Infrastructure services
    "DNS Server":"#7c3aed","Active Directory":"#0078d4","DHCP Server":"#059669",
    "Samba":"#dc2626","Squid":"#92400e",
}

# Maps detected_services keys/values → tag names
_WEB_TAG_MAP = {
    "nginx":"Nginx","apache":"Apache","iis":"IIS","tomcat":"Tomcat","jboss":"JBoss",
    "haproxy":"HAProxy","traefik":"Traefik","varnish":"Varnish","envoy":"Envoy",
    "caddy":"Caddy","lighttpd":"lighttpd","jetty":"Jetty","glassfish":"Jetty",
}
_DB_TAG_MAP = {
    "postgresql":"PostgreSQL","postgres":"PostgreSQL","mysql":"MySQL","mariadb":"MariaDB",
    "mssql":"MSSQL","sqlserver":"MSSQL","sql server":"MSSQL","oracle":"Oracle",
    "mongodb":"MongoDB","mongo":"MongoDB","redis":"Redis",
    "elasticsearch":"Elasticsearch","cassandra":"Cassandra",
}

def _get_or_create(db: Session, name: str, color: str) -> Tag:
    tag = db.query(Tag).filter_by(name=name, origin=TagOrigin.system).first()
    if not tag:
        tag = Tag(name=name, color_code=color, origin=TagOrigin.system)
        db.add(tag); db.flush()
    return tag

def apply_auto_tags(db: Session, asset: Asset):
    desired = set()
    type_map = {
        AssetType.server_virtual: "Virtual",
        AssetType.server_physical:"Physical",
        AssetType.vcenter:        "vCenter",
        AssetType.switch:         "Switch",
        AssetType.router:         "Router",
        AssetType.firewall:       "Firewall",
        AssetType.load_balancer:  "Load Balancer",
        AssetType.ap:             "Access Point",
        AssetType.database:       "Database",
        AssetType.web_server:     "Web Server",
        AssetType.storage_array:  "Storage",
        AssetType.k8s_cluster:    "Kubernetes",
        AssetType.container:      "Container",
    }
    if asset.type in type_map:
        desired.add(type_map[asset.type])
    if asset.vendor:
        v = asset.vendor.lower()
        for kw, tag in [("cisco","Cisco"),("vmware","VMware"),("dell","Dell"),("hp","HP"),("hewlett","HP"),("juniper","Juniper")]:
            if kw in v: desired.add(tag); break
    desired.add("EDR Active" if asset.edr_installed else "EDR Missing")
    desired.add("Monitored"  if asset.monitored     else "No Monitoring")
    desired.add("SIEM Active" if asset.siem_enabled  else "SIEM Missing")
    desired.add("Backup Local OK"  if asset.last_backup_local else "Backup Local Missing")
    desired.add("Backup Cloud OK"  if asset.last_backup_cloud else "Backup Cloud Missing")

    # Service tags from detected_services (EDR-discovered)
    svc = asset.detected_services or {}
    for sw in svc.get("web_servers", []):
        tag = _WEB_TAG_MAP.get(sw.lower())
        if tag:
            desired.add(tag)
    for eng in svc.get("databases", []):
        tag = _DB_TAG_MAP.get(eng.lower())
        if tag:
            desired.add(tag)
    if svc.get("dns_server"):
        desired.add("DNS Server")
    if svc.get("active_directory"):
        desired.add("Active Directory")
    if svc.get("dhcp_server"):
        desired.add("DHCP Server")
    if svc.get("samba"):
        desired.add("Samba")
    if svc.get("squid"):
        desired.add("Squid")
    if svc.get("haproxy") and "HAProxy" not in desired:
        desired.add("HAProxy")

    # Docker Host: server that has container assets
    if asset.type in (AssetType.server_physical, AssetType.server_virtual):
        has_containers = db.query(Asset.id).filter(
            Asset.host_asset_id == asset.id,
            Asset.type == AssetType.container.value,
        ).limit(1).scalar() is not None
        if has_containers:
            desired.add("Docker")

    # K8s node tag
    if getattr(asset, "k8s_version", None) and asset.type in (
        AssetType.server_physical, AssetType.server_virtual
    ):
        desired.add("K8s Worker")

    asset.tags = [t for t in asset.tags if t.origin != TagOrigin.system]
    for name in desired:
        asset.tags.append(_get_or_create(db, name, SYSTEM_TAGS.get(name, "#94a3b8")))

def apply_eol_tags(db, asset):
    """
    Calcula y asigna etiquetas EOL (EOL KO / EOL WARN / EOL OK) a un activo.

    Campos usados para el matching:
      Servidores:  asset.os  (ej: "Ubuntu 22.04 LTS", "RHEL 9", "Windows Server 2022")
      Bases datos: asset.db_engine + asset.db_version (ej: "postgresql" + "16.2")
      Red/Cisco:   asset.firmware_version + asset.model

    Productos soportados (deben estar en eol_products):
      OS:  ubuntu, debian, rhel, centos, windows-server, amazon-linux, rocky-linux
      DB:  postgresql, mssqlserver, mysql, mariadb, mongodb, redis
      Red: cisco-ios, cisco-ios-xe
    """
    try:
        from app.models.eol import EolCycle, EolProduct
    except ImportError:
        return

    EOL_TAGS = {
        "eol":     {"name": "EOL KO",  "color_code": "#dc2626"},
        "warning": {"name": "EOL WARN","color_code": "#d97706"},
        "ok":      {"name": "EOL OK",  "color_code": "#16a34a"},
    }

    # Limpiar etiquetas EOL anteriores (incluyendo nombres legacy)
    eol_names = {v["name"] for v in EOL_TAGS.values()} | {"EOL", "EOL Próximo"}
    asset.tags = [t for t in asset.tags if t.name not in eol_names]

    # Construir lista de (product_slug, version) candidatos
    candidates = []

    # 1. OS → ubuntu, debian, rhel, windows-server, etc.
    if asset.os:
        os_l = asset.os.lower()
        OS_MAP = [
            ("ubuntu",         r"(\d+\.\d+)",  "ubuntu"),
            ("debian",         r"(\d+)",        "debian"),
            ("rhel",           r"(\d+)",        "rhel"),
            ("red hat",        r"(\d+)",        "rhel"),
            ("centos",         r"(\d+)",        "centos"),
            ("windows server", r"(\d{4})",      "windows-server"),
            ("windows-server", r"(\d{4})",      "windows-server"),
            ("amazon linux",   r"(\d+)",        "amazon-linux"),
            ("rocky linux",    r"(\d+)",        "rocky-linux"),
            ("rocky",          r"(\d+)",        "rocky-linux"),
            ("almalinux",      r"(\d+)",        "almalinux"),
        ]
        for keyword, pattern, slug in OS_MAP:
            if keyword in os_l:
                m = _re.search(pattern, asset.os)
                if m:
                    ver = m.group(1)
                    candidates.append((slug, ver))
                    major = ver.split(".")[0]
                    if major != ver:
                        candidates.append((slug, major))
                break

    # 2. Base de datos: db_engine + db_version
    db_engine = getattr(asset, 'db_engine', None)
    db_version = getattr(asset, 'db_version', None)
    if db_engine:
        eng_l = db_engine.lower()
        DB_MAP = [
            ("postgresql",  "postgresql"),
            ("postgres",    "postgresql"),
            ("sqlserver",   "mssqlserver"),
            ("sql server",  "mssqlserver"),
            ("mysql",       "mysql"),
            ("mariadb",     "mariadb"),
            ("mongodb",     "mongodb"),
            ("mongo",       "mongodb"),
            ("redis",       "redis"),
        ]
        for kw, slug in DB_MAP:
            if kw in eng_l:
                if db_version:
                    m = _re.search(r"(\d+\.\d+)", db_version)
                    if m: candidates.append((slug, m.group(1)))
                    m2 = _re.search(r"(\d+)", db_version)
                    if m2: candidates.append((slug, m2.group(1)))
                break

    # 3. Red Cisco: firmware_version
    vendor = getattr(asset, 'vendor', None) or ''
    fw = getattr(asset, 'firmware_version', None) or ''
    model = getattr(asset, 'model', None) or ''
    if 'cisco' in vendor.lower() and fw:
        m = _re.search(r"(\d+\.\d+)", fw)
        if m:
            slug = 'cisco-ios-xe' if 'xe' in model.lower() else 'cisco-ios'
            candidates.append((slug, m.group(1)))

    # 4. Kubernetes: k8s_version
    k8s_ver = getattr(asset, 'k8s_version', None)
    asset_type_str = str(getattr(asset, 'type', '')).split('.')[-1] if hasattr(asset, 'type') else ''
    if k8s_ver and asset_type_str == 'k8s_cluster':
        m = _re.search(r"(\d+\.\d+)", k8s_ver)
        if m:
            candidates.append(("kubernetes", m.group(1)))
            major_minor = m.group(1)
            major = major_minor.split('.')[0]
            if major != major_minor:
                candidates.append(("kubernetes", major))

    if not candidates:
        return

    # Buscar ciclos EOL
    STATUS_ORDER = {"eol": 0, "warning": 1, "ok": 2, "unknown": 3}
    worst_status = None

    for prod_slug, version in candidates:
        prod = db.query(EolProduct).filter_by(product_id=prod_slug).first()
        if not prod:
            continue
        # Match exacto primero
        cycle = db.query(EolCycle).filter_by(product_id=prod_slug, cycle=version).first()
        if not cycle and '.' in version:
            # Fallback a major version
            cycle = db.query(EolCycle).filter_by(
                product_id=prod_slug, cycle=version.split(".")[0]
            ).first()
        if cycle:
            st = cycle.eol_status
            logger.debug(f"EOL match: {asset.name} → {prod_slug} {version} → {st}")
            if worst_status is None or STATUS_ORDER.get(st, 3) < STATUS_ORDER.get(worst_status, 3):
                worst_status = st

    if worst_status and worst_status != "unknown":
        tag_info = EOL_TAGS[worst_status]
        tag = db.query(Tag).filter_by(name=tag_info["name"], origin=TagOrigin.system).first()
        if not tag:
            tag = Tag(name=tag_info["name"], color_code=tag_info["color_code"],
                      origin=TagOrigin.system)
            db.add(tag); db.flush()
        if tag not in asset.tags:
            asset.tags.append(tag)
            logger.info(f"EOL tag '{tag_info['name']}' → '{asset.name}'")
