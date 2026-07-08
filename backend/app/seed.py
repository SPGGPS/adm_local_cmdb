"""
seed.py
Carga inicial de datos de ejemplo para el entorno de desarrollo y pruebas.
"""

import uuid
import logging
from datetime import datetime, timezone, date, timedelta
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.asset import Asset
from app.models.location import Zone, Site, Cell

logger = logging.getLogger("tfg.seed")

# -- Helpers --

def _uid() -> str:
    return str(uuid.uuid4())

def _now():
    return datetime.now(timezone.utc)

def _ago(days: int):
    return _now() - timedelta(days=days)

def _date(days_ago: int) -> date:
    return (datetime.now() - timedelta(days=days_ago)).date()

# -- Datos de ejemplo --

def seed_database(db: Session) -> dict:
    """Carga datos de ejemplo."""
    from app.models.eol import EolProduct, EolCycle, EolSyncStatus
    from app.services.tagging_service import apply_eol_tags
    from app.models.application import (
        Application, AppEnvironment, AppStatus,
        Service, ServiceStatus, ServiceCriticality, ServiceCategory,
        ServiceComponent, ComponentRole,
        AppInfraBinding, BindingTier
    )

    zone1_id = _uid()
    zone2_id = _uid()
    site1_id = _uid()
    site2_id = _uid()
    site3_id = _uid()
    cell1_id = _uid()
    cell2_id = _uid()
    cell3_id = _uid()
    cell4_id = _uid()

    zones = [
        Zone(id=zone1_id, name="Zona CPD Principal"),
        Zone(id=zone2_id, name="Zona Oficinas"),
    ]
    sites = [
        Site(id=site1_id, zone_id=zone1_id, name="CPD Planta Baja",
             address="Edificio Principal, Planta Baja"),
        Site(id=site2_id, zone_id=zone1_id, name="CPD Planta Alta",
             address="Edificio Principal, Planta Alta"),
        Site(id=site3_id, zone_id=zone2_id, name="Sala Técnica Oficinas",
             address="Edificio Secundario, Planta 1"),
    ]
    cells = [
        Cell(id=cell1_id, site_id=site1_id, name="Rack-A1",
             cell_type="rack", description="Rack principal CPD Planta Baja"),
        Cell(id=cell2_id, site_id=site1_id, name="Rack-A2",
             cell_type="rack", description="Rack secundario CPD Planta Baja"),
        Cell(id=cell3_id, site_id=site2_id, name="Rack-B1",
             cell_type="rack", description="Rack CPD Planta Alta"),
        Cell(id=cell4_id, site_id=site3_id, name="Rack-C1",
             cell_type="rack", description="Rack Sala Tecnica Oficinas"),
    ]

    for obj in zones + sites + cells:
        db.add(obj)
    db.flush()

    vc1_id  = _uid(); vc2_id  = _uid()
    esx_ids = [_uid() for _ in range(8)]

    assets = []

    # vCenters
    assets += [
        Asset(id=vc1_id, name="vcenter-01.sistemas.local", type="vcenter",
              vendor="VMware", model="vCenter Server Appliance",
              product_name="VMware vCenter Server", product_version="8.0.2",
              os="VMware Photon OS", ips=["10.10.0.10"],
              ram_gb=24, cpu_count=8, total_disk_gb=500,
              vcenter_host="10.10.0.10", vcenter_datacenter="DC-Principal",
              edr_installed=True, monitored=True, siem_enabled=True,
              logs_enabled=True,
              last_backup_local=_ago(1), last_backup_cloud=_ago(1),
              cell_id=cell1_id, source="manual"),

        Asset(id=vc2_id, name="vcenter-02.sistemas.local", type="vcenter",
              vendor="VMware", model="vCenter Server Appliance",
              product_name="VMware vCenter Server", product_version="7.0.3",
              os="VMware Photon OS", ips=["10.10.0.11"],
              ram_gb=16, cpu_count=4, total_disk_gb=300,
              vcenter_host="10.10.0.11", vcenter_datacenter="DC-Secundario",
              edr_installed=False, monitored=True, siem_enabled=False,
              logs_enabled=True,
              last_backup_local=_ago(3),
              cell_id=cell3_id, source="manual"),
    ]

    # Servidores físicos (ESX)
    esx_data = [
        ("esx-01", "10.10.1.1", "DL380 Gen10", 256, 32, 4000, cell1_id, vc1_id),
        ("esx-02", "10.10.1.2", "DL380 Gen10", 256, 32, 4000, cell1_id, vc1_id),
        ("esx-03", "10.10.1.3", "DL560 Gen10", 512, 64, 8000, cell1_id, vc1_id),
        ("esx-04", "10.10.1.4", "DL560 Gen10", 512, 64, 8000, cell2_id, vc1_id),
        ("esx-05", "10.10.1.5", "DL380 Gen9",  192, 24, 3000, cell2_id, vc2_id),
        ("esx-06", "10.10.1.6", "DL380 Gen9",  192, 24, 3000, cell2_id, vc2_id),
        ("esx-07", "10.10.1.7", "R750",         384, 48, 6000, cell3_id, vc2_id),
        ("esx-08", "10.10.1.8", "R750",         384, 48, 6000, cell3_id, vc2_id),
    ]
    for i, (name, ip, model, ram, cpu, disk, cell, vc) in enumerate(esx_data):
        assets.append(Asset(
            id=esx_ids[i],
            name=f"{name}.sistemas.local", type="server_physical",
            vendor="HPE" if "DL" in model else "Dell",
            model=model, product_name=f"ProLiant {model}" if "DL" in model else f"PowerEdge {model}",
            os="VMware ESXi 8.0.2", ips=[ip],
            ram_gb=ram, cpu_count=cpu, total_disk_gb=disk,
            edr_installed=True, monitored=True, siem_enabled=True, logs_enabled=True,
            last_backup_local=_ago(1), last_backup_cloud=_ago(2),
            vcenter_id=vc, vcenter_name="vcenter-01" if vc == vc1_id else "vcenter-02",
            cell_id=cell, source="manual"
        ))

    # Máquinas virtuales
    vm_configs = [
        # (name_suffix, os, ram, cpu, edr, mon, siem, logs, backup_local, backup_cloud, esx_idx)
        # Windows Server 2019/2022 — bien configurados
        ("win-ad-01",     "Windows Server 2022", 8, 4, True, True, True, True, True, True, 0),
        ("win-ad-02",     "Windows Server 2022", 8, 4, True, True, True, True, True, True, 1),
        ("win-file-01",   "Windows Server 2019", 16, 8, True, True, True, True, True, True, 0),
        ("win-file-02",   "Windows Server 2019", 16, 8, True, True, True, True, True, False, 1),
        ("win-print-01",  "Windows Server 2019", 8,  4, True, True, False, True, True, False, 2),
        ("win-wsus-01",   "Windows Server 2022", 16, 4, True, True, True,  True, True, True, 2),
        ("win-rds-01",    "Windows Server 2022", 32, 8, True, True, True,  True, True, True, 3),
        ("win-rds-02",    "Windows Server 2022", 32, 8, True, True, True,  True, True, True, 3),
        ("win-app-01",    "Windows Server 2019", 16, 4, True, True, True,  True, True, True, 0),
        ("win-app-02",    "Windows Server 2019", 16, 4, True, True, True,  True, False, False, 1),
        # Ubuntu 22.04 LTS — con soporte
        ("ub22-web-01",   "Ubuntu 22.04 LTS", 8,  4, True, True, True, True, True, True, 2),
        ("ub22-web-02",   "Ubuntu 22.04 LTS", 8,  4, True, True, True, True, True, True, 3),
        ("ub22-web-03",   "Ubuntu 22.04 LTS", 8,  4, True, True, False,True, True, False, 4),
        ("ub22-api-01",   "Ubuntu 22.04 LTS", 16, 8, True, True, True, True, True, True, 4),
        ("ub22-api-02",   "Ubuntu 22.04 LTS", 16, 8, True, True, True, True, True, True, 5),
        ("ub22-db-01",    "Ubuntu 22.04 LTS", 32, 8, True, True, True, True, True, True, 5),
        ("ub22-db-02",    "Ubuntu 22.04 LTS", 32, 8, True, True, True, True, True, True, 6),
        ("ub22-mon-01",   "Ubuntu 22.04 LTS", 16, 4, True, True, True, True, True, True, 6),
        ("ub22-log-01",   "Ubuntu 22.04 LTS", 32, 8, True, True, True, True, True, True, 7),
        ("ub22-bck-01",   "Ubuntu 22.04 LTS", 16, 4, True, True, True, True, True, True, 7),
        # Ubuntu 20.04 LTS — soporte hasta abril 2025
        ("ub20-app-01",   "Ubuntu 20.04 LTS", 8,  4, True, True, True, True, True, True, 0),
        ("ub20-app-02",   "Ubuntu 20.04 LTS", 8,  4, True, True, True, True, True, False, 1),
        ("ub20-svc-01",   "Ubuntu 20.04 LTS", 16, 4, True, True, False,True, True, True, 2),
        ("ub20-svc-02",   "Ubuntu 20.04 LTS", 16, 4, True, True, True, True, True, True, 3),
        # Ubuntu 18.04 (EOL)
        ("ub18-legacy-01","Ubuntu 18.04 LTS", 8,  2, False,True, False,True, True, False, 4),
        ("ub18-legacy-02","Ubuntu 18.04 LTS", 4,  2, False,False,False,False,False,False,5),
        # CentOS 7 (EOL)
        ("centos7-01",    "CentOS 7",          8,  4, False,True, False,True, True, False, 6),
        ("centos7-02",    "CentOS 7",          16, 4, False,False,False,False,False,False,7),
        ("centos7-03",    "CentOS 7",          8,  2, False,True, False,False,False,False,0),
        # Debian 12 — con soporte
        ("deb12-app-01",  "Debian 12",         8,  4, True, True, True, True, True, True, 1),
        ("deb12-app-02",  "Debian 12",         8,  4, True, True, True, True, True, False, 2),
        ("deb12-svc-01",  "Debian 12",         16, 8, True, True, True, True, True, True, 3),
        # RHEL 9 — con soporte
        ("rhel9-app-01",  "Red Hat Enterprise Linux 9", 16, 8, True, True, True, True, True, True, 4),
        ("rhel9-app-02",  "Red Hat Enterprise Linux 9", 16, 8, True, True, True, True, True, True, 5),
        ("rhel9-db-01",   "Red Hat Enterprise Linux 9", 32, 8, True, True, True, True, True, True, 6),
        # Windows Server sin EDR (excepción técnica)
        ("win-legacy-01", "Windows Server 2016", 8, 4, False,True, False,True, True, False, 7),
        ("win-legacy-02", "Windows Server 2016", 8, 4, False,True, False,True, True, False, 0),
        # VMs de servicios internos
        ("vm-dns-01",     "Ubuntu 22.04 LTS", 4,  2, True, True, True, True, True, True, 1),
        ("vm-dns-02",     "Ubuntu 22.04 LTS", 4,  2, True, True, True, True, True, True, 2),
        ("vm-ntp-01",     "Ubuntu 22.04 LTS", 2,  1, True, True, True, True, True, True, 3),
        ("vm-smtp-01",    "Ubuntu 22.04 LTS", 4,  2, True, True, True, True, True, True, 4),
        ("vm-proxy-01",   "Ubuntu 22.04 LTS", 8,  4, True, True, True, True, True, True, 5),
        ("vm-proxy-02",   "Ubuntu 22.04 LTS", 8,  4, True, True, True, True, True, True, 6),
        ("vm-ldap-01",    "Ubuntu 22.04 LTS", 8,  4, True, True, True, True, True, True, 7),
        ("vm-siem-01",    "Ubuntu 22.04 LTS", 32, 8, True, True, True, True, True, True, 0),
        ("vm-itsm-01",    "Windows Server 2019", 16, 4, True, True, True, True, True, True, 1),
        ("vm-erp-01",     "Windows Server 2022", 32, 8, True, True, True, True, True, True, 2),
        ("vm-erp-02",     "Windows Server 2022", 32, 8, True, True, True, True, True, True, 3),
        ("vm-bpm-01",     "Windows Server 2019", 16, 4, True, True, True, True, True, True, 4),
        ("vm-portal-01",  "Ubuntu 22.04 LTS", 8,  4, True, True, True, True, True, True, 5),
        ("vm-portal-02",  "Ubuntu 22.04 LTS", 8,  4, True, True, True, True, True, True, 6),
        ("vm-sede-01",    "Ubuntu 22.04 LTS", 16, 8, True, True, True, True, True, True, 7),
        ("vm-sede-02",    "Ubuntu 22.04 LTS", 16, 8, True, True, True, True, True, True, 0),
        ("vm-padron-01",  "Windows Server 2019", 16, 8, True, True, True, True, True, True, 1),
        ("vm-hacienda-01","Windows Server 2022", 32, 8, True, True, True, True, True, True, 2),
        ("vm-urb-01",     "Ubuntu 20.04 LTS", 8,  4, True, True, False,True, True, False, 3),
        ("vm-rrhh-01",    "Windows Server 2019", 8, 4, True, True, True, True, True, True, 4),
        ("vm-sgd-01",     "Ubuntu 22.04 LTS", 8,  4, True, True, True, True, True, True, 5),
        ("vm-archivo-01", "Windows Server 2019", 8, 4, True, True, True, True, True, True, 6),
    ]

    vm_ids = []
    for i, (name, os, ram, cpu, edr, mon, siem, logs, bl, bc, esx_i) in enumerate(vm_configs):
        vid = _uid()
        vm_ids.append(vid)
        esx_id = esx_ids[esx_i % len(esx_ids)]
        vc_id  = vc1_id if esx_i < 4 else vc2_id
        vc_name = "vcenter-01" if esx_i < 4 else "vcenter-02"
        assets.append(Asset(
            id=vid, name=f"{name}.sistemas.local", type="server_virtual",
            vendor="VMware", os=os,
            ram_gb=ram, cpu_count=cpu, total_disk_gb=ram * 10,
            ips=[f"10.10.{(i // 50) + 2}.{(i % 50) + 10}"],
            edr_installed=edr, monitored=mon, siem_enabled=siem, logs_enabled=logs,
            last_backup_local=_ago(1) if bl else None,
            last_backup_cloud=_ago(2) if bc else None,
            vcenter_id=vc_id, vcenter_name=vc_name,
            hypervisor_id=esx_id, hypervisor_name=f"esx-0{esx_i+1}",
            cell_id=cell1_id if esx_i < 4 else (cell2_id if esx_i < 6 else cell3_id),
            source="manual"
        ))

    # Bases de datos
    db_host_vm_ids = vm_ids[15:25]  # VMs Ubuntu/RHEL para alojar BDs

    db_configs = [
        # PostgreSQL
        ("pg-padron",      "PostgreSQL", "16.3",  "padron_municipal",    5432,  vm_ids[21]),
        ("pg-hacienda",    "PostgreSQL", "16.3",  "gestion_tributaria",  5432,  vm_ids[22]),
        ("pg-sede",        "PostgreSQL", "15.7",  "sede_electronica",    5432,  vm_ids[23]),
        ("pg-rrhh",        "PostgreSQL", "14.12", "recursos_humanos",    5432,  vm_ids[15]),
        ("pg-contab",      "PostgreSQL", "13.15", "contabilidad",        5432,  vm_ids[16]),
        ("pg-urb",         "PostgreSQL", "12.19", "urbanismo",           5432,  vm_ids[17]),
        ("pg-archivo",     "PostgreSQL", "16.3",  "archivo_documental",  5432,  vm_ids[18]),
        ("pg-itsm",        "PostgreSQL", "15.7",  "itsm",                5432,  vm_ids[19]),
        # MySQL / MariaDB
        ("mysql-web-01",   "MySQL",      "8.0.37","portal_web",          3306,  vm_ids[20]),
        ("mysql-web-02",   "MySQL",      "8.0.37","servicios_online",    3306,  vm_ids[21]),
        ("mariadb-app-01", "MariaDB",    "11.4.3","aplicacion_interna",  3306,  vm_ids[22]),
        ("mariadb-app-02", "MariaDB",    "10.11.8","legacy_app",         3306,  vm_ids[23]),
        # SQL Server
        ("mssql-erp-01",   "SQL Server", "2022",  "erp_principal",       1433,  vm_ids[24]),
        ("mssql-erp-02",   "SQL Server", "2022",  "erp_reportes",        1433,  vm_ids[25]),
        ("mssql-bpm-01",   "SQL Server", "2019",  "bpm_workflow",        1433,  vm_ids[26]),
        ("mssql-rrhh-01",  "SQL Server", "2019",  "nominas",             1433,  vm_ids[27]),
        ("mssql-legacy-01","SQL Server", "2016",  "sistema_legacy",      1433,  vm_ids[28]),
        # MongoDB
        ("mongo-docs-01",  "MongoDB",    "7.0.12","documentos",          27017, vm_ids[15]),
        ("mongo-logs-01",  "MongoDB",    "7.0.12","logs_aplicacion",     27017, vm_ids[16]),
        ("mongo-cache-01", "MongoDB",    "6.0.17","cache_datos",         27017, vm_ids[17]),
        # Redis
        ("redis-cache-01", "Redis",      "7.4.0", "cache_sesiones",      6379,  vm_ids[18]),
        ("redis-cache-02", "Redis",      "7.4.0", "cache_api",           6379,  vm_ids[19]),
        ("redis-queue-01", "Redis",      "7.2.5", "cola_trabajos",       6379,  vm_ids[20]),
        # Elasticsearch
        ("elastic-01",     "Elasticsearch","8.15.0","indices_busqueda",  9200,  vm_ids[21]),
        ("elastic-02",     "Elasticsearch","7.17.24","logs_legado",      9200,  vm_ids[22]),
        # Oracle (legado)
        ("oracle-fin-01",  "Oracle",     "19c",   "financiero_legado",   1521,  vm_ids[23]),
        ("oracle-con-01",  "Oracle",     "12c",   "contabilidad_legada", 1521,  vm_ids[24]),
        # Más PostgreSQL para llegar a 30
        ("pg-backup-01",   "PostgreSQL", "16.3",  "backup_catalogue",    5432,  vm_ids[25]),
        ("pg-monitor-01",  "PostgreSQL", "15.7",  "monitoring_data",     5432,  vm_ids[26]),
        ("pg-audit-01",    "PostgreSQL", "16.3",  "audit_logs",          5432,  vm_ids[27]),
    ]

    db_ids = []
    for i, (name, engine, version, schema, port, host_vm_id) in enumerate(db_configs):
        did = _uid()
        db_ids.append(did)
        os_map = {
            "PostgreSQL": "Ubuntu 22.04 LTS",
            "MySQL": "Ubuntu 22.04 LTS",
            "MariaDB": "Ubuntu 20.04 LTS",
            "SQL Server": "Windows Server 2019",
            "MongoDB": "Ubuntu 22.04 LTS",
            "Redis": "Ubuntu 22.04 LTS",
            "Elasticsearch": "Ubuntu 22.04 LTS",
            "Oracle": "Red Hat Enterprise Linux 9",
        }
        assets.append(Asset(
            id=did,
            name=f"{name}.sistemas.local", type="database",
            vendor=engine,
            db_engine=engine, db_version=version,
            db_host=f"{name}-host.sistemas.local",
            db_port=port,
            db_size_gb=50 + (i * 20),
            db_host_asset_id=host_vm_id,
            db_host_display=f"vm-host-{i+1:02d}",
            os=os_map.get(engine, "Linux"),
            ips=[f"10.10.5.{10 + i}"],
            edr_installed=(engine not in ["Redis", "MongoDB"]),
            monitored=True,
            siem_enabled=(i % 3 != 2),
            logs_enabled=True,
            last_backup_local=_ago(1),
            last_backup_cloud=_ago(3) if i % 2 == 0 else None,
            cell_id=cell1_id if i < 15 else cell2_id,
            source="manual"
        ))

    # Servidores web
    web_host_vm_ids = vm_ids[10:20]

    web_configs = [
        # Nginx
        ("nginx-sede-01",  "Nginx", "1.26.2", "Ubuntu 22.04 LTS", vm_ids[10]),
        ("nginx-sede-02",  "Nginx", "1.26.2", "Ubuntu 22.04 LTS", vm_ids[11]),
        ("nginx-portal-01","Nginx", "1.26.2", "Ubuntu 22.04 LTS", vm_ids[12]),
        ("nginx-portal-02","Nginx", "1.24.0", "Ubuntu 22.04 LTS", vm_ids[13]),
        ("nginx-api-01",   "Nginx", "1.26.2", "Ubuntu 22.04 LTS", vm_ids[14]),
        ("nginx-api-02",   "Nginx", "1.26.2", "Ubuntu 22.04 LTS", vm_ids[10]),
        ("nginx-int-01",   "Nginx", "1.24.0", "Ubuntu 20.04 LTS", vm_ids[11]),
        ("nginx-rev-01",   "Nginx", "1.26.2", "Ubuntu 22.04 LTS", vm_ids[12]),
        ("nginx-rev-02",   "Nginx", "1.26.2", "Ubuntu 22.04 LTS", vm_ids[13]),
        ("nginx-cdn-01",   "Nginx", "1.26.2", "Ubuntu 22.04 LTS", vm_ids[14]),
        # Apache
        ("apache-urb-01",  "Apache", "2.4.62", "Ubuntu 22.04 LTS", vm_ids[10]),
        ("apache-urb-02",  "Apache", "2.4.62", "Ubuntu 22.04 LTS", vm_ids[11]),
        ("apache-app-01",  "Apache", "2.4.58", "Ubuntu 20.04 LTS", vm_ids[12]),
        ("apache-app-02",  "Apache", "2.4.58", "Debian 12",        vm_ids[13]),
        ("apache-doc-01",  "Apache", "2.4.62", "Debian 12",        vm_ids[14]),
        ("apache-rpt-01",  "Apache", "2.4.62", "Ubuntu 22.04 LTS", vm_ids[10]),
        ("apache-old-01",  "Apache", "2.4.51", "CentOS 7",         vm_ids[11]),
        # IIS
        ("iis-erp-01",    "IIS", "10.0", "Windows Server 2019",   vm_ids[12]),
        ("iis-erp-02",    "IIS", "10.0", "Windows Server 2022",   vm_ids[13]),
        ("iis-rrhh-01",   "IIS", "10.0", "Windows Server 2019",   vm_ids[14]),
        ("iis-hacienda-01","IIS","10.0", "Windows Server 2022",   vm_ids[10]),
        ("iis-bpm-01",    "IIS", "10.0", "Windows Server 2019",   vm_ids[11]),
        ("iis-legacy-01", "IIS", "8.5",  "Windows Server 2016",   vm_ids[12]),
        # Tomcat / JBoss
        ("tomcat-gest-01", "Tomcat", "10.1.30", "Ubuntu 22.04 LTS", vm_ids[13]),
        ("tomcat-gest-02", "Tomcat", "10.1.30", "Ubuntu 22.04 LTS", vm_ids[14]),
        ("tomcat-app-01",  "Tomcat", "9.0.93",  "Ubuntu 20.04 LTS", vm_ids[10]),
        ("tomcat-app-02",  "Tomcat", "9.0.93",  "RHEL 9",           vm_ids[11]),
        ("jboss-erp-01",   "JBoss",  "7.4",     "RHEL 9",           vm_ids[12]),
        ("jboss-app-01",   "JBoss",  "7.4",     "RHEL 9",           vm_ids[13]),
        ("jboss-old-01",   "JBoss",  "5.1",     "CentOS 7",         vm_ids[14]),
    ]

    web_ids = []
    for i, (name, software, version, os_ver, host_vm_id) in enumerate(web_configs):
        wid = _uid()
        web_ids.append(wid)
        assets.append(Asset(
            id=wid,
            name=f"{name}.sistemas.local", type="web_server",
            vendor=software,
            product_name=software, product_version=version,
            web_server_software=software.lower(),
            web_server_version=version,
            web_server_port=443 if i % 3 == 0 else 80,
            os=os_ver,
            ips=[f"10.10.6.{10 + i}"],
            edr_installed=(i % 5 != 4),
            monitored=True,
            siem_enabled=(i % 4 != 3),
            logs_enabled=True,
            last_backup_local=_ago(1) if i % 3 != 2 else None,
            last_backup_cloud=_ago(7) if i % 2 == 0 else None,
            host_asset_id=host_vm_id,
            host_asset_name=f"vm-host-{i+1:02d}.sistemas.local",
            cell_id=cell2_id if i < 15 else cell3_id,
            source="manual"
        ))

    # Switches
    switch_configs = [
        ("sw-core-01",  "Cisco",   "Catalyst 9500",  "17.12.3", 48, cell1_id),
        ("sw-core-02",  "Cisco",   "Catalyst 9500",  "17.12.3", 48, cell1_id),
        ("sw-dist-01",  "Cisco",   "Catalyst 9300",  "17.9.5",  48, cell1_id),
        ("sw-dist-02",  "Cisco",   "Catalyst 9300",  "17.9.5",  48, cell2_id),
        ("sw-dist-03",  "Cisco",   "Catalyst 9300",  "17.9.5",  48, cell2_id),
        ("sw-acc-01",   "Cisco",   "Catalyst 9200",  "17.6.7",  24, cell1_id),
        ("sw-acc-02",   "Cisco",   "Catalyst 9200",  "17.6.7",  24, cell2_id),
        ("sw-acc-03",   "Cisco",   "Catalyst 9200",  "17.6.7",  24, cell3_id),
        ("sw-acc-04",   "Cisco",   "Catalyst 3750",  "12.2.55", 24, cell4_id),
        ("sw-acc-05",   "HP",      "ProCurve 2920",  "WB.16.10",24, cell4_id),
        ("sw-san-01",   "Cisco",   "MDS 9148S",      "8.4.2",   32, cell1_id),
        ("sw-san-02",   "Cisco",   "MDS 9148S",      "8.4.2",   32, cell2_id),
        ("sw-dmz-01",   "Cisco",   "Catalyst 9200",  "17.6.7",  24, cell1_id),
        ("sw-ofi-01",   "HP",      "ProCurve 2530",  "YA.16.04",24, cell4_id),
        ("sw-ofi-02",   "HP",      "ProCurve 2530",  "YA.16.04",24, cell4_id),
    ]

    for i, (name, vendor, model, fw, ports, cell) in enumerate(switch_configs):
        assets.append(Asset(
            id=_uid(),
            name=f"{name}.sistemas.local", type="switch",
            vendor=vendor, model=model,
            product_name=model, firmware_version=fw,
            port_count=ports,
            ips=[f"10.10.7.{10 + i}"],
            edr_installed=False,  # switches no admiten agentes EDR
            monitored=True, siem_enabled=True, logs_enabled=True,
            last_backup_local=_ago(7),
            cell_id=cell, source="manual"
        ))

    # Routers
    router_configs = [
        ("rt-core-01", "Cisco", "ISR 4451", "16.12.9", cell1_id),
        ("rt-core-02", "Cisco", "ISR 4451", "16.12.9", cell1_id),
        ("rt-edge-01", "Cisco", "ISR 4331", "16.12.9", cell1_id),
        ("rt-wan-01",  "Cisco", "ASR 1001", "17.9.4",  cell1_id),
        ("rt-ofi-01",  "HP",    "MSR3060",  "7.1.070", cell4_id),
    ]
    for i, (name, vendor, model, fw, cell) in enumerate(router_configs):
        assets.append(Asset(
            id=_uid(),
            name=f"{name}.sistemas.local", type="router",
            vendor=vendor, model=model,
            product_name=model, firmware_version=fw,
            ips=[f"10.10.8.{10 + i}"],
            edr_installed=False, monitored=True, siem_enabled=True, logs_enabled=True,
            last_backup_local=_ago(7),
            cell_id=cell, source="manual"
        ))

    # Firewalls
    fw_configs = [
        ("fw-perimeter-01", "Palo Alto",  "PA-5250",    "11.1.4", cell1_id),
        ("fw-perimeter-02", "Palo Alto",  "PA-5250",    "11.1.4", cell1_id),
        ("fw-internal-01",  "Fortinet",   "FortiGate 200F","7.4.5",cell1_id),
        ("fw-internal-02",  "Fortinet",   "FortiGate 200F","7.4.5",cell2_id),
        ("fw-dmz-01",       "Cisco",      "ASA 5525-X", "9.20.3", cell1_id),
        ("fw-ofi-01",       "Fortinet",   "FortiGate 60F","7.4.5", cell4_id),
    ]
    for i, (name, vendor, model, fw, cell) in enumerate(fw_configs):
        assets.append(Asset(
            id=_uid(),
            name=f"{name}.sistemas.local", type="firewall",
            vendor=vendor, model=model,
            product_name=model, firmware_version=fw,
            ips=[f"10.10.9.{10 + i}"],
            fw_type=vendor.lower().replace(" ", ""),
            fw_policy_count=50 + (i * 10),
            fw_ha_mode="active-passive" if i % 2 == 0 else "standalone",
            fw_nat_enabled=True,
            fw_vpn_enabled=(i < 2),
            edr_installed=False, monitored=True, siem_enabled=True, logs_enabled=True,
            last_backup_local=_ago(7), last_backup_cloud=_ago(30),
            cell_id=cell, source="manual"
        ))

    # Balanceadores de carga
    lb_configs = [
        ("lb-web-01",  "F5",    "BIG-IP 2000s", "17.1.1", cell1_id),
        ("lb-web-02",  "F5",    "BIG-IP 2000s", "17.1.1", cell1_id),
        ("lb-app-01",  "HAProxy","HAProxy",      "2.9.9",  cell2_id),
        ("lb-app-02",  "HAProxy","HAProxy",      "2.9.9",  cell2_id),
    ]
    for i, (name, vendor, model, ver, cell) in enumerate(lb_configs):
        assets.append(Asset(
            id=_uid(),
            name=f"{name}.sistemas.local", type="load_balancer",
            vendor=vendor, model=model,
            product_name=model, product_version=ver,
            lb_software=vendor.lower().replace(" ", ""),
            lb_algorithm=["roundrobin", "leastconn", "iphash", "random"][i % 4],
            lb_virtual_servers=4 + i,
            lb_pool_members=[
                {"ip": f"10.10.2.{10+j}", "port": 8080, "weight": 1, "state": "up"}
                for j in range(3)
            ],
            lb_ssl_offload=(i % 2 == 0),
            ips=[f"10.10.10.{10 + i}"],
            edr_installed=(vendor != "F5"),
            monitored=True, siem_enabled=True, logs_enabled=True,
            last_backup_local=_ago(7),
            cell_id=cell, source="manual"
        ))

    # Puntos de acceso WiFi
    ap_configs = [
        ("ap-hall-01",   "Cisco", "Catalyst 9130AX", "17.12.3", cell4_id),
        ("ap-hall-02",   "Cisco", "Catalyst 9130AX", "17.12.3", cell4_id),
        ("ap-ofi-01",    "Cisco", "Catalyst 9120AX", "17.12.3", cell4_id),
        ("ap-ofi-02",    "Cisco", "Catalyst 9120AX", "17.12.3", cell4_id),
        ("ap-ofi-03",    "Cisco", "Catalyst 9120AX", "17.9.5",  cell4_id),
        ("ap-sala-01",   "HP",    "Aruba AP-515",    "8.12.0",  cell4_id),
        ("ap-sala-02",   "HP",    "Aruba AP-515",    "8.12.0",  cell4_id),
        ("ap-exterior-01","Cisco","Catalyst 9124AXD","17.12.3", cell4_id),
    ]
    for i, (name, vendor, model, fw, cell) in enumerate(ap_configs):
        assets.append(Asset(
            id=_uid(),
            name=f"{name}.sistemas.local", type="ap",
            vendor=vendor, model=model,
            product_name=model, firmware_version=fw,
            ips=[f"10.10.11.{10 + i}"],
            coverage_area=f"Zona {i+1}",
            connected_clients=10 + (i * 5),
            edr_installed=False, monitored=True, siem_enabled=False, logs_enabled=True,
            cell_id=cell, source="manual"
        ))

    # Workstations
    ws_configs = [
        ("ws-tic-01",  "HP",    "EliteDesk 800 G8",  "Windows 11 Pro", 16, 8,  True),
        ("ws-tic-02",  "HP",    "EliteDesk 800 G8",  "Windows 11 Pro", 16, 8,  True),
        ("ws-tic-03",  "Dell",  "OptiPlex 7090",     "Windows 11 Pro", 16, 8,  True),
        ("ws-admin-01","Dell",  "OptiPlex 7090",     "Windows 11 Pro", 8,  4,  True),
        ("ws-admin-02","HP",    "EliteBook 850 G9",  "Windows 11 Pro", 16, 8,  True),
        ("ws-dev-01",  "Apple", "MacBook Pro M3",    "macOS 15",       32, 8,  False),
        ("ws-dev-02",  "Apple", "MacBook Pro M3",    "macOS 15",       32, 8,  False),
        ("ws-gis-01",  "Dell",  "Precision 5570",    "Windows 11 Pro", 32, 12, True),
        ("ws-cad-01",  "HP",    "Z4 G5 Workstation", "Windows 11 Pro", 64, 16, True),
        ("ws-legacy-01","HP",   "EliteDesk 705 G4",  "Windows 10 Pro", 8,  4,  False),
    ]
    for i, (name, vendor, model, os_ver, ram, cpu, edr) in enumerate(ws_configs):
        assets.append(Asset(
            id=_uid(),
            name=f"{name}.sistemas.local", type="workstation",
            vendor=vendor, model=model,
            product_name=model, os=os_ver,
            ram_gb=ram, cpu_count=cpu, total_disk_gb=512,
            ips=[f"10.10.12.{10 + i}"],
            edr_installed=edr, monitored=True,
            siem_enabled=False, logs_enabled=edr,
            cell_id=cell4_id, source="manual"
        ))

    # Storage arrays
    storage_configs = [
        ("san-01",  "HPE",    "MSA 2062",    "VL010R001", 50000,  cell1_id),
        ("san-02",  "HPE",    "Primera 650", "4.5.0.160", 200000, cell1_id),
        ("nas-01",  "NetApp", "FAS500f",     "9.14.1",    100000, cell2_id),
        ("nas-02",  "NetApp", "AFF A400",    "9.14.1",    200000, cell2_id),
        ("backup-01","Dell",  "PowerProtect DD9900","7.10",50000, cell3_id),
    ]
    for i, (name, vendor, model, fw, disk, cell) in enumerate(storage_configs):
        assets.append(Asset(
            id=_uid(),
            name=f"{name}.sistemas.local", type="storage_array",
            vendor=vendor, model=model,
            product_name=model, firmware_version=fw,
            total_disk_gb=disk,
            ips=[f"10.10.13.{10 + i}"],
            edr_installed=False, monitored=True, siem_enabled=True, logs_enabled=True,
            cell_id=cell, source="manual"
        ))

    # Clústeres Kubernetes
    k8s_configs = [
        ("k8s-prod-01",  "k3s",      "1.31.2", 3, 6,  cell1_id),
        ("k8s-dev-01",   "k3s",      "1.31.2", 1, 3,  cell2_id),
        ("k8s-mon-01",   "kubeadm",  "1.30.5", 3, 3,  cell1_id),
        ("k8s-test-01",  "k3s",      "1.29.9", 1, 2,  cell3_id),
    ]
    for i, (name, provider, ver, cp, workers, cell) in enumerate(k8s_configs):
        assets.append(Asset(
            id=_uid(),
            name=f"{name}.sistemas.local", type="k8s_cluster",
            vendor="CNCF",
            product_name="Kubernetes", product_version=ver,
            k8s_provider=provider,
            k8s_control_plane_count=cp,
            k8s_worker_count=workers,
            k8s_container_runtime="containerd",
            k8s_network_plugin="cilium",
            ips=[f"10.10.14.{10 + i}"],
            edr_installed=False, monitored=True, siem_enabled=True, logs_enabled=True,
            cell_id=cell, source="manual"
        ))

    # Contenedores
    container_configs = [
        ("cnt-nginx-01",    "nginx",        "1.27.2",  "running", "inventario"),
        ("cnt-postgres-01", "postgres",     "16.4",    "running", "inventario"),
        ("cnt-redis-01",    "redis",        "7.4.1",   "running", "inventario"),
        ("cnt-grafana-01",  "grafana",      "11.2.2",  "running", "monitoring"),
        ("cnt-prometheus-01","prom/prometheus","2.54.1","running","monitoring"),
        ("cnt-alertmgr-01", "prom/alertmanager","0.27.0","running","monitoring"),
        ("cnt-loki-01",     "grafana/loki", "3.2.0",   "running", "logging"),
        ("cnt-fluentd-01",  "fluentd",      "1.17.1",  "running", "logging"),
        ("cnt-traefik-01",  "traefik",      "3.2.0",   "running", "ingress"),
        ("cnt-vault-01",    "vault",        "1.18.0",  "running", "security"),
        ("cnt-keycloak-01", "keycloak",     "25.0.6",  "running", "auth"),
        ("cnt-minio-01",    "minio",        "RELEASE.2024-10",  "running", "storage"),
        ("cnt-old-01",      "python",       "3.9-slim", "running", "legacy"),
    ]
    for i, (name, image, tag, status, project) in enumerate(container_configs):
        assets.append(Asset(
            id=_uid(),
            name=f"{name}", type="container",
            vendor="Docker",
            container_image=image, container_image_tag=tag,
            container_status=status,
            container_compose_project=project,
            container_compose_service=name.replace("cnt-","").rsplit("-",1)[0],
            ips=[f"172.18.{i}.2"],
            edr_installed=False, monitored=True, siem_enabled=False, logs_enabled=True,
            cell_id=cell1_id, source="manual"
        ))

    # Productos EOL y ciclos de versiones

    eol_products_data = [
        # (product_id, display_name, category, cycles)
        # cycles = [(cycle, eol_date_str, lts)]
        ("ubuntu", "Ubuntu Linux", "os", [
            ("18.04", "2023-04-30", True),   # EOL KO
            ("20.04", "2025-04-02", True),   # EOL KO (pasó abril 2025)
            ("22.04", "2027-04-01", True),   # EOL WARN (< 365 días)
            ("24.04", "2029-04-01", True),   # EOL OK (> 365 días desde 2026)
            ("25.04", "2026-01-15", False),  # EOL KO
        ]),
        ("centos", "CentOS Linux", "os", [
            ("7",  "2024-06-30", False),     # EOL KO
            ("8",  "2021-12-31", False),     # EOL KO
            ("9",  "2027-05-31", False),     # EOL OK (Stream)
        ]),
        ("debian", "Debian GNU/Linux", "os", [
            ("10", "2024-06-30", False),     # EOL KO (Buster)
            ("11", "2026-08-15", True),      # próximo a EOL
            ("12", "2028-06-10", True),      # EOL OK (Bookworm)
        ]),
        ("rhel", "Red Hat Enterprise Linux", "os", [
            ("7",  "2024-06-30", False),     # EOL KO
            ("8",  "2029-05-31", True),      # EOL OK
            ("9",  "2032-05-31", True),      # EOL OK
        ]),
        ("windows-server", "Windows Server", "os", [
            ("2012", "2023-10-10", False),   # EOL KO
            ("2016", "2027-01-11", False),
            ("2019", "2029-01-09", False),   # EOL OK
            ("2022", "2031-10-13", False),   # EOL OK
        ]),
        ("postgresql", "PostgreSQL", "database", [
            ("12", "2024-11-14", False),     # EOL KO
            ("13", "2025-11-13", False),     # EOL KO
            ("14", "2026-11-12", False),   
            ("15", "2027-11-11", False),     # EOL OK
            ("16", "2028-11-09", False),     # EOL OK
        ]),
        ("mysql", "MySQL", "database", [
            ("8.0", "2026-04-30", False),    # EOL KO
            ("8.4", "2029-04-30", True),     # EOL OK (LTS)
        ]),
        ("mariadb", "MariaDB", "database", [
            ("10.6",  "2026-07-06", False),
            ("10.11", "2028-02-16", True),   # EOL OK
            ("11.4",  "2029-05-29", True),   # EOL OK
        ]),
        ("mssqlserver", "Microsoft SQL Server", "database", [
            ("2016", "2026-07-12", False), 
            ("2019", "2030-01-08", False),   # EOL OK
            ("2022", "2033-01-11", False),   # EOL OK
        ]),
        ("mongodb", "MongoDB", "database", [
            ("6.0", "2024-07-01", False),    # EOL KO
            ("7.0", "2026-08-01", False),  
            ("8.0", "2027-10-01", False),    # EOL OK
        ]),
        ("redis", "Redis", "database", [
            ("7.2", "2025-09-30", False),    # EOL KO
            ("7.4", "2027-03-31", False),    # EOL OK
        ]),
    ]

    now_utc = _now()
    for product_id, display_name, category, cycles in eol_products_data:
        prod = EolProduct(
            id=_uid(),
            product_id=product_id,
            display_name=display_name,
            category=category,
            sync_status=EolSyncStatus.synced,
            last_synced_at=now_utc,
        )
        db.add(prod)
        for cycle_name, eol_date_str, lts in cycles:
            from datetime import date as _date_cls
            parts = eol_date_str.split("-")
            eol_d = _date_cls(int(parts[0]), int(parts[1]), int(parts[2]))
            cycle_obj = EolCycle(
                id=_uid(),
                product_id=product_id,
                cycle=cycle_name,
                eol_date=eol_d,
                lts=lts,
                sync_status=EolSyncStatus.synced,
                last_synced_at=now_utc,
            )
            db.add(cycle_obj)

    try:
        db.commit()
        logger.info(f"EOL seed: {len(eol_products_data)} productos con sus ciclos insertados OK")
    except Exception as e:
        logger.error(f"ERROR en EOL seed commit: {e}")
        db.rollback()
        raise

    # SERVICIOS Y APLICACIONES (10 servicios, 15 aplicaciones)

    # IDs de servicios
    svc_sede_id    = _uid(); svc_padron_id  = _uid(); svc_hacienda_id = _uid()
    svc_urb_id     = _uid(); svc_rrhh_id    = _uid(); svc_intranet_id = _uid()
    svc_correo_id  = _uid(); svc_erp_id     = _uid(); svc_monitor_id  = _uid()
    svc_backup_id  = _uid()

    services = [
        Service(id=svc_sede_id,    name="Sede Electrónica",
                description="Portal de trámites electrónicos ciudadanos",
                category=ServiceCategory.citizen_portal, status=ServiceStatus.active,
                criticality=ServiceCriticality.critical, owner_team="Administración Electrónica"),
        Service(id=svc_padron_id,  name="Padrón Municipal",
                description="Gestión del padrón de habitantes",
                category=ServiceCategory.citizen_portal, status=ServiceStatus.active,
                criticality=ServiceCriticality.critical, owner_team="Secretaría"),
        Service(id=svc_hacienda_id,name="Gestión Tributaria",
                description="Liquidación y recaudación de tributos municipales",
                category=ServiceCategory.citizen_portal, status=ServiceStatus.active,
                criticality=ServiceCriticality.critical, owner_team="Hacienda"),
        Service(id=svc_urb_id,     name="Urbanismo Online",
                description="Tramitación de licencias de obras y urbanismo",
                category=ServiceCategory.citizen_portal, status=ServiceStatus.active,
                criticality=ServiceCriticality.high, owner_team="Urbanismo"),
        Service(id=svc_rrhh_id,    name="Portal RRHH",
                description="Gestión de recursos humanos y nóminas",
                category=ServiceCategory.internal_tool, status=ServiceStatus.active,
                criticality=ServiceCriticality.high, owner_team="RRHH"),
        Service(id=svc_intranet_id,name="Intranet Municipal",
                description="Portal interno de empleados y documentación",
                category=ServiceCategory.internal_tool, status=ServiceStatus.active,
                criticality=ServiceCriticality.medium, owner_team="Sistemas TI"),
        Service(id=svc_correo_id,  name="Correo Corporativo",
                description="Servicio de correo electrónico y mensajería",
                category=ServiceCategory.infrastructure, status=ServiceStatus.active,
                criticality=ServiceCriticality.high, owner_team="Sistemas TI"),
        Service(id=svc_erp_id,     name="ERP Municipal",
                description="Sistema de planificación de recursos municipales",
                category=ServiceCategory.internal_tool, status=ServiceStatus.active,
                criticality=ServiceCriticality.critical, owner_team="Intervención"),
        Service(id=svc_monitor_id, name="Monitorización TI",
                description="Plataforma de monitorización de infraestructura",
                category=ServiceCategory.infrastructure, status=ServiceStatus.active,
                criticality=ServiceCriticality.medium, owner_team="Sistemas TI"),
        Service(id=svc_backup_id,  name="Copias de Seguridad",
                description="Sistema centralizado de backup y recuperación",
                category=ServiceCategory.infrastructure, status=ServiceStatus.active,
                criticality=ServiceCriticality.critical, owner_team="Sistemas TI"),
    ]

    # IDs de aplicaciones
    app_sede_front_id  = _uid(); app_sede_back_id   = _uid()
    app_padron_id      = _uid(); app_hacienda_id    = _uid()
    app_urb_id         = _uid(); app_rrhh_id        = _uid()
    app_intranet_id    = _uid(); app_correo_id      = _uid()
    app_erp_id         = _uid(); app_grafana_id     = _uid()
    app_prometheus_id  = _uid(); app_veeam_id       = _uid()
    app_keycloak_id    = _uid(); app_nginx_lb_id    = _uid()
    app_fileserver_id  = _uid()

    applications = [
        Application(id=app_sede_front_id, name="Sede Electrónica Frontend",
                    description="Interfaz web ciudadana de la sede electrónica",
                    version="3.2.1", environment=AppEnvironment.production,
                    status=AppStatus.active, owner_team="Administración Electrónica",
                    tech_stack=["React", "Nginx", "TLS"]),
        Application(id=app_sede_back_id,  name="Sede Electrónica API",
                    description="API REST backend de la sede electrónica",
                    version="3.2.1", environment=AppEnvironment.production,
                    status=AppStatus.active, owner_team="Administración Electrónica",
                    tech_stack=["Java", "Spring Boot", "PostgreSQL"]),
        Application(id=app_padron_id,     name="Sistema Padrón",
                    description="Aplicación de gestión del padrón municipal",
                    version="5.1.0", environment=AppEnvironment.production,
                    status=AppStatus.active, owner_team="Secretaría",
                    tech_stack=["Windows Server", "SQL Server", "IIS"]),
        Application(id=app_hacienda_id,   name="Gestión Tributaria App",
                    description="Aplicación de gestión de tributos y recaudación",
                    version="4.3.2", environment=AppEnvironment.production,
                    status=AppStatus.active, owner_team="Hacienda",
                    tech_stack=["Java", "Oracle", "JBoss"]),
        Application(id=app_urb_id,        name="Urbanismo App",
                    description="Gestión de licencias de obras y expedientes urbanísticos",
                    version="2.8.0", environment=AppEnvironment.production,
                    status=AppStatus.active, owner_team="Urbanismo",
                    tech_stack=["PHP", "MySQL", "Apache"]),
        Application(id=app_rrhh_id,       name="RRHH y Nóminas",
                    description="Sistema de gestión de personal y nóminas",
                    version="6.0.1", environment=AppEnvironment.production,
                    status=AppStatus.active, owner_team="RRHH",
                    tech_stack=["Windows Server", "SQL Server", "IIS"]),
        Application(id=app_intranet_id,   name="Portal Intranet",
                    description="Portal interno de documentos y comunicación interna",
                    version="2.1.0", environment=AppEnvironment.production,
                    status=AppStatus.active, owner_team="Sistemas TI",
                    tech_stack=["SharePoint", "Windows Server"]),
        Application(id=app_correo_id,     name="Exchange Online Connector",
                    description="Conector de correo corporativo con Exchange",
                    version="1.5.0", environment=AppEnvironment.production,
                    status=AppStatus.active, owner_team="Sistemas TI",
                    tech_stack=["Windows Server", "Exchange"]),
        Application(id=app_erp_id,        name="ERP SAP",
                    description="Módulos SAP para gestión municipal",
                    version="S/4HANA 2023", environment=AppEnvironment.production,
                    status=AppStatus.active, owner_team="Intervención",
                    tech_stack=["SAP", "HANA DB", "Windows Server"]),
        Application(id=app_grafana_id,    name="Grafana Dashboards",
                    description="Dashboards de monitorización de infraestructura",
                    version="11.2.2", environment=AppEnvironment.production,
                    status=AppStatus.active, owner_team="Sistemas TI",
                    tech_stack=["Grafana", "Prometheus", "Docker"]),
        Application(id=app_prometheus_id, name="Prometheus + Alertmanager",
                    description="Sistema de métricas y alertas",
                    version="2.54.1", environment=AppEnvironment.production,
                    status=AppStatus.active, owner_team="Sistemas TI",
                    tech_stack=["Prometheus", "Alertmanager", "Docker"]),
        Application(id=app_veeam_id,      name="Veeam Backup",
                    description="Plataforma de copias de seguridad y recuperación",
                    version="12.2", environment=AppEnvironment.production,
                    status=AppStatus.active, owner_team="Sistemas TI",
                    tech_stack=["Veeam", "Windows Server", "SAN"]),
        Application(id=app_keycloak_id,   name="Keycloak SSO",
                    description="Servidor de identidad y acceso (SSO corporativo)",
                    version="25.0.6", environment=AppEnvironment.production,
                    status=AppStatus.active, owner_team="Sistemas TI",
                    tech_stack=["Keycloak", "PostgreSQL", "Docker"]),
        Application(id=app_nginx_lb_id,   name="Nginx Load Balancer",
                    description="Balanceador de carga y proxy inverso perimetral",
                    version="1.26.2", environment=AppEnvironment.production,
                    status=AppStatus.active, owner_team="Sistemas TI",
                    tech_stack=["Nginx", "Ubuntu", "TLS"]),
        Application(id=app_fileserver_id, name="Servidor de Ficheros",
                    description="Almacenamiento compartido de documentos internos",
                    version="Windows Server 2022", environment=AppEnvironment.production,
                    status=AppStatus.active, owner_team="Sistemas TI",
                    tech_stack=["Windows Server", "SMB", "NAS"]),
    ]

    # Componentes: qué aplicaciones forman cada servicio
    components = [
        ServiceComponent(service_id=svc_sede_id,    application_id=app_sede_front_id, role=ComponentRole.frontend,    order_index=1),
        ServiceComponent(service_id=svc_sede_id,    application_id=app_sede_back_id,  role=ComponentRole.backend,     order_index=2),
        ServiceComponent(service_id=svc_sede_id,    application_id=app_keycloak_id,   role=ComponentRole.auth,        order_index=3),
        ServiceComponent(service_id=svc_sede_id,    application_id=app_nginx_lb_id,   role=ComponentRole.ingress,     order_index=0),
        ServiceComponent(service_id=svc_padron_id,  application_id=app_padron_id,     role=ComponentRole.backend,     order_index=1),
        ServiceComponent(service_id=svc_hacienda_id,application_id=app_hacienda_id,   role=ComponentRole.backend,     order_index=1),
        ServiceComponent(service_id=svc_urb_id,     application_id=app_urb_id,        role=ComponentRole.backend,     order_index=1),
        ServiceComponent(service_id=svc_rrhh_id,    application_id=app_rrhh_id,       role=ComponentRole.backend,     order_index=1),
        ServiceComponent(service_id=svc_intranet_id,application_id=app_intranet_id,   role=ComponentRole.backend,     order_index=1),
        ServiceComponent(service_id=svc_correo_id,  application_id=app_correo_id,     role=ComponentRole.backend,     order_index=1),
        ServiceComponent(service_id=svc_erp_id,     application_id=app_erp_id,        role=ComponentRole.backend,     order_index=1),
        ServiceComponent(service_id=svc_monitor_id, application_id=app_grafana_id,    role=ComponentRole.frontend,    order_index=1),
        ServiceComponent(service_id=svc_monitor_id, application_id=app_prometheus_id, role=ComponentRole.monitoring,  order_index=2),
        ServiceComponent(service_id=svc_backup_id,  application_id=app_veeam_id,      role=ComponentRole.backend,     order_index=1),
    ]

    # AppInfraBindings: qué activos soportan cada aplicación
    # Usamos índices de los vm_ids y db_ids ya creados
    infra_bindings = [
    
        AppInfraBinding(application_id=app_sede_front_id, asset_id=vm_ids[10], binding_tier=BindingTier.compute),
        AppInfraBinding(application_id=app_sede_front_id, asset_id=vm_ids[11], binding_tier=BindingTier.compute),
        AppInfraBinding(application_id=app_sede_back_id,  asset_id=vm_ids[15], binding_tier=BindingTier.compute),
        AppInfraBinding(application_id=app_sede_back_id,  asset_id=db_ids[0],  binding_tier=BindingTier.data),

        AppInfraBinding(application_id=app_padron_id,     asset_id=vm_ids[44], binding_tier=BindingTier.compute),
        AppInfraBinding(application_id=app_padron_id,     asset_id=db_ids[12], binding_tier=BindingTier.data),

        AppInfraBinding(application_id=app_hacienda_id,   asset_id=vm_ids[45], binding_tier=BindingTier.compute),
        AppInfraBinding(application_id=app_hacienda_id,   asset_id=db_ids[25], binding_tier=BindingTier.data),

        AppInfraBinding(application_id=app_erp_id,        asset_id=vm_ids[46], binding_tier=BindingTier.compute),
        AppInfraBinding(application_id=app_erp_id,        asset_id=vm_ids[47], binding_tier=BindingTier.compute),
        AppInfraBinding(application_id=app_erp_id,        asset_id=db_ids[13], binding_tier=BindingTier.data),

        AppInfraBinding(application_id=app_keycloak_id,   asset_id=vm_ids[16], binding_tier=BindingTier.compute),
        AppInfraBinding(application_id=app_keycloak_id,   asset_id=db_ids[7],  binding_tier=BindingTier.data),

        AppInfraBinding(application_id=app_grafana_id,    asset_id=vm_ids[17], binding_tier=BindingTier.compute),
        AppInfraBinding(application_id=app_prometheus_id, asset_id=vm_ids[17], binding_tier=BindingTier.compute),

        AppInfraBinding(application_id=app_veeam_id,      asset_id=vm_ids[48], binding_tier=BindingTier.compute),
    ]

    for obj in services + applications + components:
        db.add(obj)
    db.commit()
    logger.info(f"Servicios seed: {len(services)} servicios, {len(applications)} apps insertados")

    # Activos adicionales para cobertura de pruebas
    web_prod_01_id = _uid()
    assets += [
        # web-prod-01 para pruebas EOL
        Asset(id=web_prod_01_id,
              name="web-prod-01", type="web_server",
              vendor="Nginx", product_name="Nginx", product_version="1.26.2",
              web_server_software="nginx", web_server_version="1.26.2", web_server_port=443,
              os="Ubuntu 24.04 LTS",
              ips=["10.10.6.100"],
              edr_installed=True, monitored=True, siem_enabled=True, logs_enabled=True,
              host_asset_id=vm_ids[10], host_asset_name="ub22-web-01.sistemas.local",
              cell_id=cell2_id, source="manual"),
        # BD PostgreSQL adicional
        Asset(id=_uid(),
              name="postgres-prod-01", type="database",
              vendor="PostgreSQL", db_engine="PostgreSQL", db_version="16.2",
              db_host="postgres-prod-01-host.sistemas.local", db_port=5432,
              db_host_asset_id=vm_ids[15],
              os="Ubuntu 22.04 LTS", ips=["10.10.5.100"],
              edr_installed=True, monitored=True, siem_enabled=True, logs_enabled=True,
              last_backup_local=_ago(1), last_backup_cloud=_ago(2),
              cell_id=cell1_id, source="manual"),
        # BD SQL Server adicional
        Asset(id=_uid(),
              name="sqlserver-erp-01", type="database",
              vendor="SQL Server", db_engine="SQL Server", db_version="2019",
              db_host="sqlserver-erp-01-host.sistemas.local", db_port=1433,
              db_host_asset_id=esx_ids[0],
              os="Windows Server 2019", ips=["10.10.5.101"],
              edr_installed=True, monitored=True, siem_enabled=True, logs_enabled=True,
              last_backup_local=_ago(1), last_backup_cloud=_ago(3),
              cell_id=cell1_id, source="manual"),
        # BD en servidor físico
        Asset(id=_uid(),
              name="db-bare-01", type="database",
              vendor="PostgreSQL", db_engine="PostgreSQL", db_version="15.7",
              db_host="db-bare-01-host.sistemas.local", db_port=5432,
              db_host_asset_id=esx_ids[0],
              os="Ubuntu 22.04 LTS", ips=["10.10.5.102"],
              edr_installed=True, monitored=True, siem_enabled=True, logs_enabled=True,
              last_backup_local=_ago(1),
              cell_id=cell1_id, source="manual"),
    ]

    # Activos
    total = 0
    batch_size = 50
    for i in range(0, len(assets), batch_size):
        batch = assets[i:i+batch_size]
        for asset in batch:
            db.add(asset)
        db.commit()
        total += len(batch)
        logger.info(f"  Insertados {total}/{len(assets)} activos...")

    total = len(assets)
    by_type = {}
    for a in assets:
        by_type[a.type] = by_type.get(a.type, 0) + 1

    logger.info(f"Seed completado: {total} activos insertados")
    for t, n in sorted(by_type.items()):
        logger.info(f"  {t}: {n}")

    for obj in infra_bindings:
        db.add(obj)
    db.commit()
    logger.info(f"InfraBindings seed: {len(infra_bindings)} bindings insertados")

    # Aplicar etiquetas EOL
    logger.info("Aplicando etiquetas EOL a los activos...")
    eol_tagged = 0
    fresh_assets = db.query(Asset).all()
    for asset in fresh_assets:
        try:
            apply_eol_tags(db, asset)
            eol_tagged += 1
        except Exception as e:
            logger.warning(f"  EOL tag error en {getattr(asset, 'name', '?')}: {e}")
    db.commit()
    logger.info(f"Etiquetas EOL aplicadas: {eol_tagged} activos procesados")

    return {"total": total, "by_type": by_type}

# Arranque

def seed_if_empty():
    """Carga datos de ejemplo si la BD está vacía."""
    import os
    force = os.getenv("FORCE_RESEED", "false").lower() == "true"
    db: Session = SessionLocal()
    try:
        count = db.query(Asset).count()
        if force and count > 0:
            logger.info(f"FORCE_RESEED=true — limpiando base de datos...")
            from app.models.eol import EolCycle, EolProduct
            from app.models.application import (
                AppInfraBinding, ServiceComponent, Application, Service
            )
            db.query(AppInfraBinding).delete()
            db.query(ServiceComponent).delete()
            db.query(Application).delete()
            db.query(Service).delete()
            db.query(Asset).delete()
            db.query(EolCycle).delete()
            db.query(EolProduct).delete()
            db.commit()
            count = 0
        if count == 0:
            logger.info("Cargando datos de ejemplo (200 activos)...")
            result = seed_database(db)
            logger.info(f"Seed completado: {result['total']} activos insertados")
        else:
            logger.info(f"Base de datos con {count} activos — seed omitido")
    except Exception as e:
        logger.error(f"Error en seed: {e}")
        db.rollback()
    finally:
        db.close()
