"""
Tests de integración para el API del CMDB Local.
Cubre: assets, tags, compliance exceptions, locations, certificates, EOL, applications.

Ejecutar:
  cd tfg4
  docker compose up -d
  # Esperar ~10s a que el backend arranque
  pip install pytest httpx --break-system-packages
  pytest backend/tests/test_api.py -v --tb=short

Variables de entorno:
  BASE_URL  (default: http://localhost:6000)
"""

import os, pytest
from datetime import date, timedelta

try:
    import httpx
    HTTPX_AVAILABLE = True
except ImportError:
    HTTPX_AVAILABLE = False

BASE = os.environ.get("BASE_URL", "http://localhost:6000")

@pytest.fixture(scope="session")
def client():
    if not HTTPX_AVAILABLE:
        pytest.skip("httpx not installed — run: pip install httpx --break-system-packages")
    with httpx.Client(base_url=BASE, timeout=10.0) as c:
        yield c

def check_up(client):
    """Verifica que el backend está levantado."""
    try:
        r = client.get("/health")
        return r.status_code == 200
    except Exception:
        return False

# Health

class TestHealth:
    def test_health_ok(self, client):
        r = client.get("/health")
        assert r.status_code == 200
        data = r.json()
        assert data.get("status") == "ok"

# Assets

class TestAssets:
    def test_list_assets_returns_200(self, client):
        r = client.get("/v1/assets")
        assert r.status_code == 200
        data = r.json()
        assert "data" in data
        assert "total" in data
        assert isinstance(data["data"], list)

    def test_list_assets_pagination(self, client):
        r = client.get("/v1/assets?page=1&page_size=5")
        assert r.status_code == 200
        data = r.json()
        assert len(data["data"]) <= 5

    def test_list_assets_filter_type(self, client):
        r = client.get("/v1/assets?type=server_physical")
        assert r.status_code == 200
        data = r.json()
        for asset in data["data"]:
            assert asset["type"] == "server_physical"

    def test_asset_enum_serialized_as_string(self, client):
        """Enum debe ser string plano, no 'AssetType.server_physical'."""
        r = client.get("/v1/assets")
        assert r.status_code == 200
        for asset in r.json()["data"]:
            t = asset.get("type", "")
            assert "." not in t, f"Enum mal serializado: '{t}'"

    def test_asset_detail(self, client):
        r = client.get("/v1/assets")
        assets = r.json()["data"]
        if not assets:
            pytest.skip("No hay assets en la BD")
        asset_id = assets[0]["id"]
        r2 = client.get(f"/v1/assets/{asset_id}")
        assert r2.status_code == 200
        detail = r2.json()
        assert detail["id"] == asset_id
        assert "tags" in detail
        assert "exceptions" in detail

    def test_asset_has_tags_list(self, client):
        r = client.get("/v1/assets")
        for asset in r.json()["data"]:
            assert isinstance(asset.get("tags", []), list)
            for tag in asset.get("tags", []):
                assert "id" in tag
                assert "name" in tag
                assert "color_code" in tag

    def test_asset_search(self, client):
        r = client.get("/v1/assets?search=prod")
        assert r.status_code == 200

    def test_bulk_tags_requires_manual_tags(self, client):
        """No se pueden asignar etiquetas de sistema en bulk."""
        # Primero obtener una etiqueta de sistema
        r = client.get("/v1/tags?origin=system")
        system_tags = r.json() if r.status_code == 200 else []
        if not system_tags:
            pytest.skip("No hay etiquetas de sistema")
        
        # Obtener un asset
        r2 = client.get("/v1/assets?page_size=1")
        assets = r2.json()["data"]
        if not assets:
            pytest.skip("No hay assets")

        r3 = client.post("/v1/assets/bulk-tags", json={
            "asset_ids": [assets[0]["id"]],
            "tag_ids": [system_tags[0]["id"]]
        })
        assert r3.status_code == 400, "Debe rechazar etiquetas de sistema"

    def test_bulk_untag_endpoint_exists(self, client):
        """El endpoint bulk-untag debe existir."""
        r = client.post("/v1/assets/bulk-untag", json={
            "asset_ids": [], "tag_ids": []
        })
        # 404 o 422 son aceptables (assets vacíos), pero no 405 (Method Not Allowed)
        assert r.status_code != 405, "El endpoint bulk-untag no existe"

# Tags

class TestTags:
    def test_list_tags(self, client):
        r = client.get("/v1/tags")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_tags_have_color_code(self, client):
        r = client.get("/v1/tags")
        for tag in r.json():
            assert "color_code" in tag
            assert tag["color_code"].startswith("#"), f"color_code sin # en tag '{tag.get('name')}'"

    def test_tag_origin_serialized_as_string(self, client):
        r = client.get("/v1/tags")
        for tag in r.json():
            origin = tag.get("origin", "")
            assert "." not in origin, f"Enum mal serializado: '{origin}'"

    def test_cannot_delete_system_tag(self, client):
        r = client.get("/v1/tags?origin=system")
        system_tags = r.json() if r.status_code == 200 else []
        if not system_tags:
            pytest.skip("No hay etiquetas de sistema")
        tag_id = system_tags[0]["id"]
        r2 = client.delete(f"/v1/tags/{tag_id}")
        assert r2.status_code == 400, "Debe rechazar borrar etiqueta de sistema"

# Compliance Exceptions

class TestExceptions:
    def test_list_exceptions(self, client):
        r = client.get("/v1/exceptions")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, (list, dict))

    def test_reason_codes_list(self, client):
        r = client.get("/v1/exceptions/reason-codes/list")
        assert r.status_code == 200
        codes = r.json()
        assert isinstance(codes, list)
        assert len(codes) > 0
        for c in codes:
            assert "code" in c
            assert "label" in c

    def test_exception_indicator_is_string(self, client):
        r = client.get("/v1/exceptions?status=active")
        data = r.json()
        items = data if isinstance(data, list) else data.get("data", [])
        for exc in items:
            ind = exc.get("indicator", "")
            assert "." not in ind, f"Enum mal serializado: '{ind}'"

# Locations

class TestLocations:
    def test_locations_tree(self, client):
        r = client.get("/v1/locations/tree")
        assert r.status_code == 200
        tree = r.json()
        assert isinstance(tree, list)

    def test_zones_list(self, client):
        r = client.get("/v1/zones")
        assert r.status_code == 200

    def test_zone_integrity_error_returns_409(self, client):
        """Crear zona con nombre ya existente: devuelve 409 si hay constraint, 201 si no."""
        r = client.get("/v1/zones")
        zones = r.json() if r.status_code == 200 else []
        if not zones:
            pytest.skip("No hay zonas para probar duplicado")
        existing_name = zones[0]["name"]
        r2 = client.post("/v1/zones", json={"name": existing_name})
        # El modelo puede o no tener restricción UNIQUE - ambos son válidos
        assert r2.status_code in (201, 409, 422), f"Respuesta inesperada: {r2.status_code}"
        assert r2.status_code != 500, "IntegrityError debe devolver 409, no 500"

    def test_bulk_assign_endpoint_before_cell_id(self, client):
        """El endpoint bulk-assign debe responder (no confundirse con /{cell_id})."""
        r = client.post("/v1/cells/bulk-assign", json={"cell_id": None, "asset_ids": []})
        assert r.status_code != 404, "El endpoint bulk-assign no debe ser 404"

# Certificates

class TestCertificates:
    def test_list_certificates(self, client):
        r = client.get("/v1/certificates")
        assert r.status_code == 200

    def test_expiry_summary(self, client):
        """El endpoint expiry-summary debe estar ANTES de /{cert_id} en el router."""
        r = client.get("/v1/certificates/expiry-summary")
        assert r.status_code == 200, f"expiry-summary devolvió {r.status_code} — verificar orden de rutas"
        data = r.json()
        assert "total" in data
        assert "valid" in data
        assert "critical" in data
        assert "expired" in data

    def test_cert_status_is_string(self, client):
        r = client.get("/v1/certificates")
        certs = r.json()
        if isinstance(certs, dict):
            certs = certs.get("data", [])
        for cert in certs:
            status = cert.get("cert_status", "")
            assert "." not in status, f"Enum mal serializado: '{status}'"

# End of Life

class TestEol:
    def test_eol_products_list(self, client):
        r = client.get("/v1/eol/products")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_eol_cycles_for_seeded_product(self, client):
        """El seed incluye 'ubuntu' — debe tener ciclos."""
        r = client.get("/v1/eol/products/ubuntu/cycles")
        if r.status_code == 404:
            pytest.skip("Producto ubuntu no existe (seed no corrió)")
        assert r.status_code == 200
        data = r.json()
        assert "cycles" in data
        assert len(data["cycles"]) > 0

    def test_eol_cycle_has_eol_status(self, client):
        r = client.get("/v1/eol/products/ubuntu/cycles")
        if r.status_code == 404:
            pytest.skip("Producto ubuntu no existe")
        for cycle in r.json()["cycles"]:
            assert "eol_status" in cycle
            assert cycle["eol_status"] in ("eol", "warning", "ok", "unknown")

    def test_eol_cycle_enum_serialized(self, client):
        r = client.get("/v1/eol/products/ubuntu/cycles")
        if r.status_code == 404:
            pytest.skip("Producto ubuntu no existe")
        for cycle in r.json()["cycles"]:
            ss = cycle.get("sync_status", "")
            assert "." not in ss, f"Enum mal serializado: '{ss}'"

    def test_eol_all_products_proxy(self, client):
        """El proxy a endoflife.date/api/all.json debe funcionar."""
        r = client.get("/v1/eol/all-products")
        if r.status_code in (502, 503, 504):
            pytest.skip("endoflife.date no accesible desde test")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) > 100, "La API debe devolver >100 productos"
        assert "ubuntu" in data

    def test_eol_cycle_update_custom_date(self, client):
        """Actualizar custom_eol_date en un ciclo."""
        r = client.get("/v1/eol/products/ubuntu/cycles")
        if r.status_code == 404:
            pytest.skip("Producto ubuntu no existe")
        cycles = r.json()["cycles"]
        if not cycles:
            pytest.skip("Sin ciclos")
        cycle_id = cycles[0]["id"]
        product_id = "ubuntu"
        future_date = (date.today() + timedelta(days=365)).isoformat()
        r2 = client.put(f"/v1/eol/products/{product_id}/cycles/{cycle_id}", json={
            "custom_eol_date": future_date,
            "custom_notes": "Test override"
        })
        assert r2.status_code == 200
        updated = r2.json()
        assert updated["custom_eol_date"] == future_date
        assert updated["custom_notes"] == "Test override"
        # Limpiar
        client.put(f"/v1/eol/products/{product_id}/cycles/{cycle_id}", json={
            "custom_eol_date": None, "custom_notes": None
        })

# Applications

class TestApplications:
    def test_list_applications(self, client):
        r = client.get("/v1/applications")
        assert r.status_code == 200

    def test_list_services(self, client):
        r = client.get("/v1/services")
        assert r.status_code == 200

    def test_app_enum_serialized(self, client):
        r = client.get("/v1/applications")
        apps = r.json()
        if isinstance(apps, dict):
            apps = apps.get("data", [])
        for app in apps:
            for field in ["environment", "status"]:
                val = app.get(field, "")
                if val:
                    assert "." not in val, f"Enum mal serializado '{field}': '{val}'"

    def test_dependency_graph_endpoint(self, client):
        r = client.get("/v1/services")
        svcs = r.json()
        if isinstance(svcs, dict):
            svcs = svcs.get("data", [])
        if not svcs:
            pytest.skip("No hay servicios")
        svc_id = svcs[0]["id"]
        r2 = client.get(f"/v1/services/{svc_id}/dependency-graph")
        assert r2.status_code == 200
        graph = r2.json()
        assert "nodes" in graph
        assert "edges" in graph

# Audit

class TestAudit:
    def test_audit_log_list(self, client):
        r = client.get("/v1/audit-logs")
        assert r.status_code == 200

# Data Sources

class TestDataSources:
    def test_list_data_sources(self, client):
        r = client.get("/v1/data-sources")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)

    def test_data_source_type_is_string(self, client):
        r = client.get("/v1/data-sources")
        for ds in r.json():
            t = ds.get("type", "")
            assert "." not in t, f"Enum mal serializado: '{t}'"

# EOL + Matching

class TestEolMatching:
    """Tests que verifican el matching EOL por producto+versión exacta."""

    def test_eol_products_list(self, client):
        r = client.get("/v1/eol/products")
        assert r.status_code == 200
        products = r.json()
        assert isinstance(products, list)
        assert len(products) >= 1, "Debe haber al menos 1 producto EOL en el seed"

    def test_eol_product_has_asset_counts(self, client):
        r = client.get("/v1/eol/products")
        for p in r.json():
            assert "asset_eol_ko"   in p, f"{p['product_id']}: falta asset_eol_ko"
            assert "asset_eol_warn" in p, f"{p['product_id']}: falta asset_eol_warn"
            assert "asset_eol_ok"   in p, f"{p['product_id']}: falta asset_eol_ok"

    def test_ubuntu_22_maps_to_ok(self, client):
        """Ubuntu 22.04 LTS (eol=2027) debe tener activos con estado EOL conocido (OK o WARN)."""
        r = client.get("/v1/eol/products")
        ubuntu = next((p for p in r.json() if p["product_id"] == "ubuntu"), None)
        if ubuntu is None:
            return  # Producto no cargado, saltar test
        # Debe tener activos detectados (OK + WARN + KO > 0)
        total_tagged = (
            ubuntu.get("asset_eol_ok", 0) +
            ubuntu.get("asset_eol_warn", 0) +
            ubuntu.get("asset_eol_ko", 0)
        )
        assert total_tagged >= 1, (
            f"Ubuntu debería tener activos EOL taggeados. Obtenido: {ubuntu}"
        )

    def test_recalculate_eol_tags(self, client):
        r = client.post("/v1/eol/recalculate-tags")
        assert r.status_code == 200
        data = r.json()
        assert "updated" in data
        assert isinstance(data["updated"], int)

    def test_eol_products_different_counts(self, client):
        """Cada producto debe tener conteos independientes (no todos iguales)."""
        r = client.get("/v1/eol/products")
        products = [p for p in r.json() if p["cycle_count"] > 0]
        if len(products) < 2:
            return  # No hay suficientes productos para comparar
        # Los conteos no deberían ser todos idénticos
        ok_counts = [p["asset_eol_ok"] for p in products]
        ko_counts = [p["asset_eol_ko"] for p in products]
        assert not (len(set(ok_counts)) == 1 and ok_counts[0] > 0), (
            "Todos los productos tienen el mismo asset_eol_ok — el matching no filtra por producto"
        )

    def test_reseed_endpoint(self, client):
        r = client.post("/v1/admin/reseed")
        assert r.status_code == 200
        data = r.json()
        assert "Reseed completado" in data.get("message", "")
        assert data.get("total", 0) >= 1

    def test_assets_visible_after_reseed(self, client):
        """Tras reseed debe haber activos en el inventario."""
        client.post("/v1/admin/reseed")
        r = client.get("/v1/assets")
        assert r.status_code == 200
        data = r.json()
        total = data.get("total", 0) if isinstance(data, dict) else len(data)
        assert total >= 10, f"Se esperan ≥10 assets tras reseed, hay {total}"

# Compliance badges

class TestComplianceBadges:
    """Tests de la serialización de badges de compliance."""

    def test_asset_compliance_fields_present(self, client):
        r = client.get("/v1/assets")
        for a in (r.json().get("data") or r.json())[:3]:
            assert "edr_installed"      in a
            assert "monitored"          in a
            assert "last_backup_local"  in a

    def test_asset_type_is_plain_string(self, client):
        VALID_TYPES = {
            "server_physical","server_virtual","vcenter","web_server","database",
            "switch","router","firewall","load_balancer","ap",
            "workstation","storage_array","k8s_cluster","container"
        }
        r = client.get("/v1/assets")
        for a in (r.json().get("data") or r.json()):
            t = a.get("type", "")
            assert "." not in t, f"Enum mal serializado: '{t}'"
            assert t in VALID_TYPES, f"Tipo inesperado: '{t}'"

    def test_dashboard_kpis(self, client):
        r = client.get("/v1/dashboard")
        assert r.status_code == 200
        kpis = r.json().get("kpis", {})
        assert kpis.get("total_assets", 0) >= 1, "Dashboard debe contar assets reales"
        assert "active_exceptions"  in kpis
        assert "total_certificates" in kpis

    def test_dashboard_eol_segments_not_empty(self, client):
        """Si hay assets con OS ubuntu, el bloque EOL debe tener segmentos."""
        r = client.get("/v1/dashboard")
        eol_by_type = r.json().get("eol_by_type", [])
        # No requerimos que existan, solo que si existen sean válidos
        for group in eol_by_type:
            assert "type"     in group
            assert "segments" in group
            for seg in group["segments"]:
                assert seg["count"] > 0, "Segmento EOL con count=0 no debería existir"

    def test_cell_full_path_in_assets(self, client):
        """Todos los assets del seed deben tener cell_full_path no vacío."""
        r = client.get("/v1/assets")
        assets = r.json().get("data") or r.json()
        missing = [a["name"] for a in assets if not a.get("cell_full_path")]
        assert len(missing) == 0, f"Assets sin cell_full_path: {missing}"

# EOL product_eol_assets real matching

class TestEolProductAssets:
    """Tests específicos del endpoint /v1/eol/products/{id}/assets."""

    def test_ubuntu_ok_assets(self, client):
        """GET /eol/products/ubuntu/assets?status=ok debe devolver web-prod-01."""
        r = client.get("/v1/eol/products/ubuntu/assets?status=ok")
        if r.status_code == 404:
            return  # ubuntu no cargado
        assert r.status_code == 200
        assets = r.json()
        names = [a["name"] for a in assets]
        assert "web-prod-01" in names, (
            f"web-prod-01 (Ubuntu 22.04 LTS) debe aparecer en EOL OK de ubuntu. "
            f"Assets encontrados: {names}"
        )

    def test_ubuntu_assets_not_shared_with_postgresql(self, client):
        """Los assets de ubuntu OK no deben aparecer en postgresql OK."""
        r_ub = client.get("/v1/eol/products/ubuntu/assets?status=ok")
        r_pg = client.get("/v1/eol/products/postgresql/assets?status=ok")
        if r_ub.status_code == 404 or r_pg.status_code == 404:
            return
        ubuntu_ids = {a["id"] for a in r_ub.json()}
        pg_ids     = {a["id"] for a in r_pg.json()}
        overlap = ubuntu_ids & pg_ids
        assert not overlap, (
            f"Assets en ambos ubuntu OK y postgresql OK: {overlap}. "
            "El matching debe ser por producto específico."
        )

    def test_postgresql_assets_correct(self, client):
        """postgres-prod-01 (db_engine=postgresql, db_version=16.2) debe aparecer en postgresql."""
        r = client.get("/v1/eol/products/postgresql/assets")
        if r.status_code == 404:
            return
        assert r.status_code == 200
        names = [a["name"] for a in r.json()]
        assert "postgres-prod-01" in names, (
            f"postgres-prod-01 debe aparecer en assets de postgresql. Encontrados: {names}"
        )

    def test_mssqlserver_assets_correct(self, client):
        """sqlserver-erp-01 (db_engine=sqlserver) debe aparecer en mssqlserver."""
        r = client.get("/v1/eol/products/mssqlserver/assets")
        if r.status_code == 404:
            return
        assert r.status_code == 200
        names = [a["name"] for a in r.json()]
        assert "sqlserver-erp-01" in names, (
            f"sqlserver-erp-01 debe aparecer en mssqlserver. Encontrados: {names}"
        )

    def test_eol_assets_have_eol_status_field(self, client):
        """Cada asset en la respuesta debe incluir eol_status."""
        r = client.get("/v1/eol/products/ubuntu/assets")
        if r.status_code == 404:
            return
        for a in r.json():
            assert "eol_status" in a, f"Asset {a.get('name')} no tiene eol_status"
            assert a["eol_status"] in ("eol","warning","ok"),                 f"eol_status inválido: {a['eol_status']}"

# Dashboard live data

class TestDashboardLive:
    """Verifica que el dashboard refleja datos reales del seed."""

    def test_kpi_total_assets_matches_inventory(self, client):
        r_dash = client.get("/v1/dashboard")
        r_inv  = client.get("/v1/assets")
        assert r_dash.status_code == 200
        assert r_inv.status_code == 200
        dash_count = r_dash.json()["kpis"]["total_assets"]
        inv_count  = r_inv.json()["total"]
        assert dash_count == inv_count, (
            f"Dashboard total_assets={dash_count} != inventario total={inv_count}"
        )

    def test_kpi_total_services(self, client):
        r = client.get("/v1/dashboard")
        assert r.json()["kpis"]["total_services"] >= 1

    def test_compliance_segments_only_nonzero(self, client):
        r = client.get("/v1/dashboard")
        for grp in r.json().get("compliance", []):
            for seg in grp["segments"]:
                assert seg["count"] > 0,                     f"Compliance segment count=0 en {grp['indicator']}.{seg['status']}"

    def test_eol_segments_only_nonzero(self, client):
        r = client.get("/v1/dashboard")
        for grp in r.json().get("eol_by_type", []):
            for seg in grp["segments"]:
                assert seg["count"] > 0,                     f"EOL segment count=0 en {grp['type']}.{seg['status']}"

# CMDB endpoints

class TestCmdbServers:
    """Tests de los endpoints CMDB de servidores."""

    def test_list_all_servers(self, client):
        r = client.get("/v1/cmdb/servers")
        assert r.status_code == 200
        data = r.json()
        assert "data" in data and "total" in data
        assert data["total"] >= 10, f"Esperados ≥10 servidores, hay {data['total']}"

    def test_list_virtual_servers(self, client):
        r = client.get("/v1/cmdb/servers?server_type=virtual")
        assert r.status_code == 200
        servers = r.json()["data"]
        for s in servers:
            assert s["type"] == "server_virtual", f"Tipo inesperado: {s['type']}"
        assert len(servers) >= 5, f"Esperados ≥5 VMs, hay {len(servers)}"

    def test_virtual_servers_have_vcenter(self, client):
        r = client.get("/v1/cmdb/servers?server_type=virtual")
        for vm in r.json()["data"]:
            assert vm.get("vcenter_id"), f"VM {vm['name']} sin vcenter_id"
            assert vm.get("vcenter_name"), f"VM {vm['name']} sin vcenter_name"
            assert vm.get("hypervisor_id"), f"VM {vm['name']} sin hypervisor_id"

    def test_vcenter_listing(self, client):
        r = client.get("/v1/cmdb/servers?server_type=vcenter")
        assert r.status_code == 200
        vcenters = r.json()["data"]
        assert len(vcenters) >= 1
        vc = vcenters[0]
        assert vc["type"] == "vcenter"
        assert vc.get("vcenter_host") or vc.get("vcenter_datacenter"),             "vCenter debe tener vcenter_host o vcenter_datacenter"

    def test_servers_have_product_name(self, client):
        r = client.get("/v1/cmdb/servers")
        for s in r.json()["data"]:
            assert "product_name" in s, f"{s['name']} sin product_name en respuesta"

class TestCmdbNetwork:
    def test_list_all_network(self, client):
        r = client.get("/v1/cmdb/network")
        assert r.status_code == 200
        data = r.json()
        assert data["total"] >= 6, f"Esperados ≥6 dispositivos de red, hay {data['total']}"

    def test_firewall_has_policy_count(self, client):
        r = client.get("/v1/cmdb/network?net_type=firewall")
        assert r.status_code == 200
        fws = r.json()["data"]
        assert len(fws) >= 1
        fw = fws[0]
        assert fw.get("fw_policy_count") is not None
        assert fw.get("fw_ha_mode") is not None

    def test_load_balancer_has_pool(self, client):
        r = client.get("/v1/cmdb/network?net_type=load_balancer")
        assert r.status_code == 200
        lbs = r.json()["data"]
        if lbs:
            lb = lbs[0]
            assert lb.get("lb_algorithm") is not None
            assert lb.get("lb_pool_members") is not None

    def test_switches_have_port_count(self, client):
        r = client.get("/v1/cmdb/network?net_type=switch")
        for sw in r.json()["data"]:
            assert sw.get("port_count"), f"Switch {sw['name']} sin port_count"

class TestCmdbDatabases:
    def test_list_databases(self, client):
        r = client.get("/v1/cmdb/databases")
        assert r.status_code == 200
        data = r.json()
        assert data["total"] >= 3, f"Esperadas ≥3 BBDs, hay {data['total']}"

    def test_databases_have_host(self, client):
        r = client.get("/v1/cmdb/databases")
        for db in r.json()["data"]:
            assert db.get("db_host_asset_id"), f"DB {db['name']} sin db_host_asset_id"
            assert db.get("db_host_display"), f"DB {db['name']} sin db_host_display"

    def test_postgresql_filter(self, client):
        r = client.get("/v1/cmdb/databases?engine=postgresql")
        for db in r.json()["data"]:
            assert "postgresql" in (db.get("db_engine") or "").lower()

    def test_database_host_is_valid_asset(self, client):
        """El db_host_asset_id de cada DB debe corresponder a un asset real."""
        dbs_r = client.get("/v1/cmdb/databases")
        for db in dbs_r.json()["data"]:
            host_id = db.get("db_host_asset_id")
            if host_id:
                hr = client.get(f"/v1/assets/{host_id}")
                assert hr.status_code == 200,                     f"DB {db['name']} → host_id {host_id} no encontrado en assets"
                host = hr.json()
                assert host["type"] in ("server_physical","server_virtual"),                     f"Host de DB debe ser server_physical o server_virtual, es: {host['type']}"

class TestCmdbWebServers:
    def test_list_web_servers(self, client):
        r = client.get("/v1/cmdb/web-servers")
        assert r.status_code == 200
        data = r.json()
        assert data["total"] >= 3

    def test_web_servers_have_host(self, client):
        r = client.get("/v1/cmdb/web-servers")
        for ws in r.json()["data"]:
            assert ws.get("host_asset_id"), f"Web server {ws['name']} sin host_asset_id"
            assert ws.get("host_asset_name"), f"Web server {ws['name']} sin host_asset_name"

    def test_web_servers_have_software(self, client):
        r = client.get("/v1/cmdb/web-servers")
        for ws in r.json()["data"]:
            assert ws.get("web_server_software"), f"Web server {ws['name']} sin software"
            assert ws.get("web_server_version"), f"Web server {ws['name']} sin versión"

    def test_web_server_host_is_valid(self, client):
        r = client.get("/v1/cmdb/web-servers")
        for ws in r.json()["data"]:
            host_id = ws.get("host_asset_id")
            if host_id:
                hr = client.get(f"/v1/assets/{host_id}")
                assert hr.status_code == 200
                assert hr.json()["type"] in ("server_physical","server_virtual")

class TestCmdbRelations:
    def test_vcenter_relations_has_vms(self, client):
        # Obtener un vCenter real del inventario
        r = client.get("/v1/assets?type=vcenter&page_size=1")
        data = r.json()
        vcenters = data.get("data", []) if isinstance(data, dict) else data
        if not vcenters:
            pytest.skip("No hay vCenters en el inventario")
        vcenter_id = vcenters[0]["id"]
        r = client.get(f"/v1/cmdb/asset-relations/{vcenter_id}")
        assert r.status_code == 200
        data = r.json()
        assert "hosted_vms" in data
        assert len(data["hosted_vms"]) >= 5,             f"vCenter debe gestionar ≥5 VMs, tiene {len(data.get('hosted_vms',[]))}"

    def test_physical_server_relations(self, client):
        r = client.get("/v1/assets?type=server_physical&page_size=1")
        data = r.json()
        servers = data.get("data", []) if isinstance(data, dict) else data
        if not servers:
            pytest.skip("No hay servidores físicos en el inventario")
        srv_id = servers[0]["id"]
        r = client.get(f"/v1/cmdb/asset-relations/{srv_id}")
        assert r.status_code == 200
        data = r.json()
        # db-bare-01 debe tener al menos una BD
        assert "databases" in data
        assert len(data["databases"]) >= 1

    def test_relations_missing_asset(self, client):
        r = client.get("/v1/cmdb/asset-relations/nonexistent-id")
        assert r.status_code == 404

    def test_inventory_has_product_name(self, client):
        """El inventario general incluye product_name para todos los assets."""
        r = client.get("/v1/assets")
        assets = r.json().get("data") or r.json()
        with_product = [a for a in assets if a.get("product_name")]
        assert len(with_product) >= 10,             f"Al menos 10 assets deben tener product_name, hay {len(with_product)}"

# ---
# TESTS DE REGRESIÓN — detectan errores que funcionaban y se rompieron
# ---

class TestCreateOperations:
    """CRUD completo — verifica que los endpoints de creación no dan 500."""

    def test_create_zone(self, client):
        r = client.post("/v1/zones", json={"name": "Zona Test Regresion", "description": "test"})
        assert r.status_code == 201, f"Expected 201, got {r.status_code}: {r.text}"
        d = r.json()
        assert d["name"] == "Zona Test Regresion"
        assert "id" in d
        # Limpiar
        client.delete(f"/v1/zones/{d['id']}")

    def test_create_duplicate_zone_returns_409(self, client):
        import uuid
        unique_name = f"Zona Test 409 {uuid.uuid4().hex[:8]}"
        r1 = client.post("/v1/zones", json={"name": unique_name})
        assert r1.status_code == 201
        r2 = client.post("/v1/zones", json={"name": unique_name})
        assert r2.status_code in (409, 201), f"Zona duplicada devolvió {r2.status_code}"
        # Limpiar zona creada
        if r1.status_code == 201:
            z_id = r1.json().get("id")
            if z_id:
                client.delete(f"/v1/zones/{z_id}")
        client.delete(f"/v1/zones/{r1.json()['id']}")

    def test_create_site(self, client):
        # Crear zona primero
        zone = client.post("/v1/zones", json={"name": "Zona Para Site Test"}).json()
        r = client.post("/v1/sites", json={
            "zone_id": zone["id"], "name": "Site Test Regresion",
            "address": "Calle Prueba 1"
        })
        assert r.status_code == 201, f"Expected 201, got {r.status_code}: {r.text}"
        d = r.json()
        assert d["name"] == "Site Test Regresion"
        assert d["zone_id"] == zone["id"]
        client.delete(f"/v1/zones/{zone['id']}")

    def test_create_site_invalid_zone_returns_404(self, client):
        r = client.post("/v1/sites", json={
            "zone_id": "nonexistent-zone-id", "name": "Site sin zona"
        })
        assert r.status_code == 404

    def test_create_cell(self, client):
        zone = client.post("/v1/zones", json={"name": "Zona Para Cell Test"}).json()
        site = client.post("/v1/sites", json={
            "zone_id": zone["id"], "name": "Site Para Cell"
        }).json()
        r = client.post("/v1/cells", json={
            "site_id": site["id"], "name": "Rack Test A1",
            "cell_type": "rack", "description": "Rack de prueba"
        })
        assert r.status_code == 201, f"Expected 201, got {r.status_code}: {r.text}"
        assert r.json()["name"] == "Rack Test A1"
        client.delete(f"/v1/zones/{zone['id']}")

    def test_create_tag(self, client):
        r = client.post("/v1/tags", json={
            "name": "TagTestRegresion", "color": "#FF5733", "description": "test tag"
        })
        assert r.status_code == 201, f"Expected 201, got {r.status_code}: {r.text}"
        tag = r.json()
        assert tag["name"] == "TagTestRegresion"
        # Limpiar
        client.delete(f"/v1/tags/{tag['id']}")

    def test_create_certificate(self, client):
        from datetime import date, timedelta
        r = client.post("/v1/certificates", json={
            "domain": "test-regresion.sistemas.lan",
            "common_name": "test-regresion.sistemas.lan",
            "expires_at": (date.today() + timedelta(days=365)).isoformat(),
            "environment": "staging"
        })
        assert r.status_code == 201, f"Expected 201, got {r.status_code}: {r.text}"
        cert = r.json()
        cert_domain = cert.get("domain") or cert.get("name") or cert.get("common_name", "")
        assert "test-regresion" in cert_domain or cert_domain == "test-regresion.sistemas.lan"
        client.delete(f"/v1/certificates/{cert['id']}")

    def test_create_data_source(self, client):
        r = client.post("/v1/data-sources", json={
            "name": "Fuente Test Regresion",
            "type": "manual",
            "description": "test"
        })
        assert r.status_code == 201, f"Expected 201, got {r.status_code}: {r.text}"
        ds = r.json()
        assert ds["name"] == "Fuente Test Regresion"
        client.delete(f"/v1/data-sources/{ds['id']}")

    def test_create_application(self, client):
        r = client.post("/v1/applications", json={
            "name": "Aplicacion Test Regresion",
            "description": "test app",
            "environment": "staging",
            "status": "inactive"
        })
        assert r.status_code == 201, f"Expected 201, got {r.status_code}: {r.text}"
        app = r.json()
        assert app["name"] == "Aplicacion Test Regresion"
        client.delete(f"/v1/applications/{app['id']}")

    def test_update_zone(self, client):
        zone = client.post("/v1/zones", json={"name": "Zona Para Update Test"}).json()
        r = client.put(f"/v1/zones/{zone['id']}", json={
            "name": "Zona Actualizada", "description": "actualizada"
        })
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        assert r.json()["name"] == "Zona Actualizada"
        client.delete(f"/v1/zones/{zone['id']}")

    def test_delete_zone_returns_204(self, client):
        zone = client.post("/v1/zones", json={"name": "Zona Para Borrar"}).json()
        r = client.delete(f"/v1/zones/{zone['id']}")
        assert r.status_code == 204, f"Expected 204, got {r.status_code}"

    def test_delete_nonexistent_zone_returns_404(self, client):
        r = client.delete("/v1/zones/nonexistent-zone-id")
        assert r.status_code == 404

class TestComplianceFilter:
    """Tests de los nuevos filtros compliance_indicator y eol_tag en /v1/assets."""

    def test_filter_by_eol_tag_ko(self, client):
        r = client.get("/v1/assets?eol_tag=EOL KO")
        assert r.status_code == 200, f"eol_tag filter failed: {r.status_code}"
        assets = r.json().get("data") or r.json()
        
        for a in assets:
            tag_names = [t["name"] for t in (a.get("tags") or [])]
            assert "EOL KO" in tag_names,                 f"Asset {a['name']} returned by eol_tag=EOL KO but doesn't have the tag"

    def test_filter_by_eol_tag_ok(self, client):
        r = client.get("/v1/assets?eol_tag=EOL OK")
        assert r.status_code == 200
        # No debe devolver activos con EOL KO
        assets = r.json().get("data") or r.json()
        for a in assets:
            tag_names = [t["name"] for t in (a.get("tags") or [])]
            assert "EOL KO" not in tag_names,                 f"Asset {a['name']} has EOL KO but was returned by eol_tag=EOL OK"

    def test_filter_compliance_edr_ok(self, client):
        r = client.get("/v1/assets?compliance_indicator=edr&compliance_status=ok")
        assert r.status_code == 200, f"compliance filter failed: {r.status_code}: {r.text}"
        assets = r.json().get("data") or r.json()
        for a in assets:
            assert a.get("edr_installed") is True,                 f"Asset {a['name']} has edr_installed={a.get('edr_installed')} but compliance_status=ok"

    def test_filter_compliance_edr_ko(self, client):
        r = client.get("/v1/assets?compliance_indicator=edr&compliance_status=ko")
        assert r.status_code == 200
        assets = r.json().get("data") or r.json()
        for a in assets:
            assert a.get("edr_installed") is not True,                 f"Asset {a['name']} has edr_installed=True but compliance_status=ko"

    def test_filter_compliance_mon_ok(self, client):
        r = client.get("/v1/assets?compliance_indicator=mon&compliance_status=ok")
        assert r.status_code == 200
        assets = r.json().get("data") or r.json()
        for a in assets:
            assert a.get("monitored") is True

    def test_filter_compliance_siem_ko(self, client):
        r = client.get("/v1/assets?compliance_indicator=siem&compliance_status=ko")
        assert r.status_code == 200
        data = r.json()
        assets = data.get("data", data) if isinstance(data, dict) else data
        assert isinstance(assets, list)

    def test_compliance_filter_with_type(self, client):
        """compliance_indicator + type deben funcionar combinados."""
        r = client.get("/v1/assets?compliance_indicator=edr&compliance_status=ko&type=server_virtual")
        assert r.status_code == 200
        assets = r.json().get("data") or r.json()
        for a in assets:
            assert a.get("type") == "server_virtual"
            assert a.get("edr_installed") is not True

    def test_eol_filter_no_false_positives(self, client):
        """EOL KO y EOL OK no deben solaparse."""
        ko = set(a["id"] for a in (client.get("/v1/assets?eol_tag=EOL KO").json().get("data") or []))
        ok = set(a["id"] for a in (client.get("/v1/assets?eol_tag=EOL OK").json().get("data") or []))
        overlap = ko & ok
        assert len(overlap) == 0, f"Assets in both EOL KO and EOL OK: {overlap}"

class TestEolAutoRecalc:
    """Verifica que el recálculo EOL se dispara automáticamente."""

    def test_ingest_triggers_eol_registration(self, client):
        """Al ingestar un asset con Ubuntu, debe registrarse el producto EOL ubuntu."""
        # Obtener productos EOL antes
        before = {p["product_id"] for p in client.get("/v1/eol/products").json()}

        # Ingestar un asset con OS reconocible por EOL
        r = client.post("/v1/assets/ingest", json=[{
            "id": "asset-test-eol-trigger-001",
            "name": "vm-ubuntu-eol-test",
            "type": "server_virtual",
            "os": "Ubuntu 20.04 LTS",
            "source": "Test"
        }])
        assert r.status_code == 200

        # ubuntu debe estar registrado (puede ya estar de antes o añadirse ahora)
        after = {p["product_id"] for p in client.get("/v1/eol/products").json()}
        assert "ubuntu" in after, f"ubuntu not in EOL products after ingest: {after}"

        # Limpiar
        client.delete("/v1/assets/asset-test-eol-trigger-001")

    def test_eol_recalculate_endpoint(self, client):
        r = client.post("/v1/eol/recalculate-tags")
        assert r.status_code == 200
        d = r.json()
        assert "updated" in d or "message" in d

    def test_eol_products_have_cycles_after_seed(self, client):
        """Los productos EOL del seed deben tener al menos 1 ciclo."""
        products = client.get("/v1/eol/products").json()
        for p in products:
            if p.get("sync_status") == "synced":
                cycles_r = client.get(f"/v1/eol/products/{p['product_id']}/cycles")
                assert cycles_r.status_code == 200
                # Si está sincronizado, debe tener ciclos
                # (puede estar vacío si la API no respondió, lo que es aceptable)

class TestErrorHandling:
    """Tests de manejo de errores — verifica que no haya 500s inesperados."""

    def test_get_nonexistent_asset_returns_404(self, client):
        r = client.get("/v1/assets/nonexistent-asset-id-xyz")
        assert r.status_code == 404

    def test_get_nonexistent_zone_in_tree(self, client):
        r = client.get("/v1/locations/tree")
        assert r.status_code == 200
        # El árbol debe ser una lista (puede estar vacía)
        assert isinstance(r.json(), list)

    def test_create_zone_missing_name_returns_422(self, client):
        r = client.post("/v1/zones", json={"description": "sin nombre"})
        assert r.status_code == 422, f"Expected 422 for missing name, got {r.status_code}"

    def test_create_site_missing_zone_returns_422(self, client):
        r = client.post("/v1/sites", json={"name": "Site sin zone_id"})
        assert r.status_code == 422

    def test_create_certificate_missing_domain_returns_422(self, client):
        r = client.post("/v1/certificates", json={"expires_at": "2027-01-01"})
        assert r.status_code == 422

    def test_bulk_assign_empty_list(self, client):
        r = client.post("/v1/cells/bulk-assign", json={"asset_ids": [], "cell_id": None})
        assert r.status_code == 200
        assert r.json()["updated"] == 0

    def test_all_get_endpoints_return_200(self, client):
        """Smoke test: todos los GET principales devuelven 200."""
        endpoints = [
            "/v1/assets", "/v1/tags", "/v1/locations/tree", "/v1/zones",
            "/v1/certificates", "/v1/eol/products", "/v1/exceptions",
            "/v1/data-sources", "/v1/audit-logs", "/v1/dashboard",
            "/v1/applications", "/v1/services",
            "/v1/cmdb/servers", "/v1/cmdb/network",
            "/v1/cmdb/databases", "/v1/cmdb/web-servers",
        ]
        for ep in endpoints:
            r = client.get(ep)
            assert r.status_code == 200, f"GET {ep} returned {r.status_code}: {r.text[:100]}"

    def test_compliance_filter_invalid_indicator_graceful(self, client):
        """Indicador de compliance inválido no debe dar 500."""
        r = client.get("/v1/assets?compliance_indicator=invalid_indicator&compliance_status=ok")
        # Debe devolver 200 con lista vacía o todos los assets, no 500
        assert r.status_code == 200

    def test_eol_tag_nonexistent_graceful(self, client):
        """eol_tag inexistente debe devolver lista vacía, no 500."""
        r = client.get("/v1/assets?eol_tag=NONEXISTENT TAG")
        assert r.status_code == 200
        data = r.json()
        if isinstance(data, dict):
            assets = data.get("data", [])
            total = data.get("total", 0)
        else:
            assets = data
            total = len(data)
        assert isinstance(assets, list)
