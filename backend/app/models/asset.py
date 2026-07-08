import uuid, enum
from datetime import datetime, timezone
from sqlalchemy import Column, String, Boolean, DateTime, Integer, JSON, ForeignKey, Enum, Text, Date
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.tag import asset_tag

class AssetType(str, enum.Enum):
    # Compute
    server_physical = "server_physical"
    server_virtual  = "server_virtual"
    workstation     = "workstation"     # PC / laptop de usuario final
    vcenter         = "vcenter"         # VMware vCenter / Hyper-V SCVMM
    # Web & App
    web_server      = "web_server"      # Nginx, Apache, IIS, Tomcat
    # Data
    database        = "database"        # RDBMS / NoSQL instance
    # Network
    switch          = "switch"
    router          = "router"
    firewall        = "firewall"
    load_balancer   = "load_balancer"
    ap              = "ap"
    # Storage
    storage_array   = "storage_array"   # SAN/NAS array
    # Containers
    k8s_cluster     = "k8s_cluster"    # Cluster Kubernetes (k3s, kubeadm, EKS…)
    container       = "container"       # Contenedor Docker/OCI

class Asset(Base):
    __tablename__ = "assets"
    id           = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name         = Column(String(255), nullable=False)
    type         = Column(String(50), nullable=False)  # stored as string, validated in app layer
    ips          = Column(JSON, nullable=True, default=list)
    mac_address  = Column(String(17), nullable=True, unique=True)
    vendor       = Column(String(100), nullable=True)
    source       = Column(String(100), nullable=True)
    data_source_id = Column(String, ForeignKey("data_sources.id", ondelete="SET NULL"), nullable=True)
    # Compliance (written only by ingest)
    edr_installed     = Column(Boolean, nullable=False, default=False)
    monitored         = Column(Boolean, nullable=False, default=False)
    siem_enabled      = Column(Boolean, nullable=False, default=False)
    logs_enabled      = Column(Boolean, nullable=False, default=False)
    monica_registered = Column(Boolean, nullable=False, default=False)
    last_backup_local = Column(DateTime(timezone=True), nullable=True)
    last_backup_cloud = Column(DateTime(timezone=True), nullable=True)
    last_sync         = Column(DateTime(timezone=True), nullable=True)
    # Server-specific
    ram_gb        = Column(Integer, nullable=True)
    total_disk_gb = Column(Integer, nullable=True)
    cpu_count     = Column(Integer, nullable=True)
    os            = Column(String(100), nullable=True)
    # Network-specific
    model            = Column(String(100), nullable=True)
    port_count       = Column(Integer, nullable=True)
    firmware_version = Column(String(50), nullable=True)
    max_speed        = Column(String(50), nullable=True)
    coverage_area    = Column(String(100), nullable=True)
    connected_clients = Column(Integer, nullable=True)
    # Database-specific (summary fields)
    db_engine      = Column(String(50), nullable=True)
    db_version     = Column(String(50), nullable=True)
    db_size_gb     = Column(Integer, nullable=True)
    db_host        = Column(String(255), nullable=True)
    db_port        = Column(Integer, nullable=True)
    db_replication = Column(Boolean, nullable=True, default=False)
    db_cluster     = Column(String(255), nullable=True)
    db_is_cluster  = Column(Boolean, nullable=True, default=False)
    db_vip         = Column(String(255), nullable=True)
    db_host_asset_id = Column(String, ForeignKey("assets.id", ondelete="SET NULL"), nullable=True)
    db_host_display  = Column(String(255), nullable=True)
    db_cluster_nodes = Column(JSON, nullable=True)
    # Database-specific (detail fields — JSON)
    db_schemas           = Column(JSON, nullable=True)
    db_users             = Column(JSON, nullable=True)
    db_connections_max   = Column(Integer, nullable=True)
    db_connections_active = Column(Integer, nullable=True)
    db_encoding          = Column(String(50), nullable=True)
    db_timezone          = Column(String(100), nullable=True)
    db_ha_mode           = Column(String(50), nullable=True)
    db_ssl_enabled       = Column(Boolean, nullable=True)
    db_audit_enabled     = Column(Boolean, nullable=True)
    db_last_vacuum       = Column(DateTime(timezone=True), nullable=True)
    db_notes             = Column(Text, nullable=True)
    # Producto (común a todos los tipos)
    product_name    = Column(String(200), nullable=True)  # ej: "ProLiant DL380 Gen10", "Nginx", "Catalyst 9300"
    product_version = Column(String(100), nullable=True)  # versión del producto/software principal

    # Virtualización — VMs y vCenters
    # Para server_virtual: referencia al vCenter y al host ESX donde reside
    vcenter_id      = Column(String, ForeignKey("assets.id", ondelete="SET NULL"), nullable=True)
    vcenter_name    = Column(String(255), nullable=True)   # desnormalizado para queries rápidas
    hypervisor_id   = Column(String, ForeignKey("assets.id", ondelete="SET NULL"), nullable=True)
    hypervisor_name = Column(String(255), nullable=True)   # host ESX/Hyper-V donde corre la VM
    # Para vcenter: gestiona N hosts y VMs
    vcenter_host    = Column(String(255), nullable=True)   # hostname/IP del vCenter
    vcenter_datacenter = Column(String(100), nullable=True)
    vcenter_cluster = Column(String(100), nullable=True)
    # Detalles de VM
    vm_guest_os           = Column(String(100), nullable=True)
    vm_tools_version      = Column(String(50),  nullable=True)
    vm_cpu_reserved_mhz   = Column(Integer, nullable=True)
    vm_memory_reserved_mb = Column(Integer, nullable=True)
    vm_datastore          = Column(String(255), nullable=True)
    vm_folder             = Column(String(255), nullable=True)
    vm_power_state        = Column(String(20),  nullable=True)  # poweredOn, poweredOff, suspended
    vm_uuid               = Column(String(64),  nullable=True, index=True)  # instanceUuid vCenter

    # Web server
    # Para web_server: referencia al servidor (físico o VM) donde corre
    web_server_software = Column(String(50), nullable=True)   # nginx, apache, iis, tomcat, caddy...
    web_server_version  = Column(String(50), nullable=True)
    web_server_port     = Column(Integer,    nullable=True)   # puerto de escucha principal
    web_listen_ips      = Column(JSON,       nullable=True)   # IPs donde escucha
    web_virtual_hosts   = Column(JSON,       nullable=True)   # lista de virtual hosts configurados
    web_ssl_enabled     = Column(Boolean,    nullable=True)
    web_ssl_cert_cn     = Column(String(255),nullable=True)          # Common Name del cert TLS activo
    web_ssl_cert_expiry = Column(DateTime(timezone=True), nullable=True)  # fecha de expiración
    web_ssl_cert_issuer = Column(String(255),nullable=True)          # CA emisora
    web_ssl_cert_san    = Column(JSON,       nullable=True)          # Subject Alternative Names
    web_ssl_cert_path   = Column(String(500),nullable=True)          # ruta al fichero cert en disco
    web_config_path     = Column(String(255),nullable=True)
    # FK al servidor host
    host_asset_id       = Column(String, ForeignKey("assets.id", ondelete="SET NULL"), nullable=True)
    host_asset_name     = Column(String(255), nullable=True)  # desnormalizado

    # Firewall
    fw_type             = Column(String(50),  nullable=True)  # pf, iptables, checkpoint, paloalto, fortinet...
    fw_policy_count     = Column(Integer,     nullable=True)
    fw_ha_mode          = Column(String(20),  nullable=True)  # standalone, active-passive, active-active
    fw_last_rule_change = Column(DateTime(timezone=True), nullable=True)
    fw_nat_enabled      = Column(Boolean,     nullable=True)
    fw_vpn_enabled      = Column(Boolean,     nullable=True)
    fw_zones            = Column(JSON,        nullable=True)  # lista de zonas configuradas

    # Load Balancer
    lb_software         = Column(String(50),  nullable=True)  # haproxy, nginx, f5, citrix...
    lb_algorithm        = Column(String(50),  nullable=True)  # roundrobin, leastconn, iphash...
    lb_virtual_servers  = Column(Integer,     nullable=True)
    lb_pool_members     = Column(JSON,        nullable=True)  # [{ip, port, weight, state}]
    lb_health_check     = Column(String(100), nullable=True)
    lb_ssl_offload      = Column(Boolean,     nullable=True)

    # Storage Array
    storage_type        = Column(String(20),  nullable=True)  # SAN, NAS, iSCSI, NVMeOF
    storage_protocol    = Column(String(50),  nullable=True)  # FC, iSCSI, NFS, SMB, NVMe
    storage_total_raw_tb = Column(Integer,    nullable=True)  # TB raw
    storage_usable_tb   = Column(Integer,     nullable=True)  # TB usable
    storage_raid_level  = Column(String(20),  nullable=True)
    storage_controller  = Column(String(100), nullable=True)
    storage_shelves     = Column(Integer,     nullable=True)

    # Kubernetes Cluster
    k8s_version           = Column(String(20),  nullable=True)   # "1.29.3"
    k8s_provider          = Column(String(50),  nullable=True)   # kubeadm, k3s, eks, gke, aks, rke2
    k8s_network_plugin    = Column(String(50),  nullable=True)   # cilium, calico, flannel, weave
    k8s_ingress_class     = Column(String(50),  nullable=True)   # traefik, nginx, haproxy
    k8s_container_runtime = Column(String(50),  nullable=True)   # containerd, docker, cri-o
    k8s_storage_class     = Column(String(100), nullable=True)
    k8s_control_plane_count = Column(Integer,   nullable=True)   # nodos manager/control-plane
    k8s_worker_count      = Column(Integer,     nullable=True)   # nodos worker
    k8s_nodes             = Column(JSON,        nullable=True)   # [{asset_id, name, role, status, version, ips}]
    k8s_namespaces        = Column(JSON,        nullable=True)   # ["default","kube-system","monitoring",...]
    k8s_pods              = Column(JSON,        nullable=True)   # [{name,namespace,status,images,node,restarts}]
    k8s_deployments       = Column(JSON,        nullable=True)   # [{name,namespace,replicas,ready,image}]
    k8s_helm_releases     = Column(JSON,        nullable=True)   # [{name,namespace,chart,chart_version,app_version,status}]

    # Container
    container_runtime     = Column(String(50),  nullable=True)   # docker, containerd, podman
    container_image       = Column(String(500), nullable=True)   # "nginx", "postgres"
    container_image_tag   = Column(String(100), nullable=True)   # "1.25.3", "latest"
    container_status      = Column(String(20),  nullable=True)   # running, stopped, exited, paused
    container_ports       = Column(JSON,        nullable=True)   # [{host_port, container_port, protocol}]
    container_network     = Column(String(100), nullable=True)   # bridge, host, overlay, none
    container_volumes     = Column(JSON,        nullable=True)   # [{source, target, type}]
    container_compose_project = Column(String(100), nullable=True)
    container_compose_service = Column(String(100), nullable=True)
    container_id              = Column(String(64),  nullable=True)   # Docker container ID (hash 64 chars)
    # host: usa host_asset_id / host_asset_name ya existentes

    # Backup (Veeam / agentes)
    backup_job_name       = Column(String(200), nullable=True)   # Nombre del job Veeam de backup local
    backup_cloud_job_name = Column(String(200), nullable=True)   # Nombre del job Veeam de copia cloud
    backup_last_status    = Column(String(20),  nullable=True)   # Success / Warning / Failed / None
    backup_restore_points = Column(Integer,     nullable=True)   # Nº de puntos de restauración disponibles

    # EDR (Agente EDR)
    edr_endpoint_id     = Column(String(100), nullable=True)   # UUID del endpoint en Agente EDR
    edr_health          = Column(String(20),  nullable=True)   # good / suspicious / bad / unknown
    edr_last_seen       = Column(DateTime(timezone=True), nullable=True)  # último contacto con EDR
    edr_tamper_protected = Column(Boolean,   nullable=True)   # tamper protection habilitada
    edr_online          = Column(Boolean,    nullable=True)   # True si lastSeenAt < 10 min al sincronizar
    edr_agent_mode      = Column(String(50), nullable=True)   # XDR / Intercept X / Standard
    edr_managed         = Column(Boolean,    nullable=True)   # True si gestionado por Agente EDR
    detected_services   = Column(JSON,       nullable=True)   # {web_servers:[…], databases:[…], web_ports:[…], db_ports:[…]}

    # Extended
    serial_number   = Column(String(100), nullable=True)
    location        = Column(String(255), nullable=True)  # texto libre legacy
    cell_id         = Column(String, ForeignKey("cells.id", ondelete="SET NULL"), nullable=True)
    description     = Column(Text, nullable=True)
    notes           = Column(Text, nullable=True)   # notas manuales del administrador
    purchase_date   = Column(Date, nullable=True)
    warranty_expiry = Column(Date, nullable=True)
    # Merge/revisión
    needs_review         = Column(Boolean, nullable=False, default=False)  # llegó de fuente secundaria sin match
    source_diffs         = Column(JSON, nullable=True)  # {source: {last_seen, diffs:[{field,current,reported}]}}
    contributing_sources = Column(JSON, nullable=True)  # ["edr-agent", "veeam"] — fuentes secundarias que enriquecieron el activo
    # Timestamps / auditoría de alta manual
    created_by  = Column(String(100), nullable=True)   # usuario que dio de alta (solo source='manual')
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))
    # Relationships
    tags        = relationship("Tag", secondary=asset_tag, back_populates="assets")
    data_source = relationship("DataSource", back_populates="assets")
    # CMDB auto-refs: accessed via explicit queries in routers, not via ORM relationships
    exceptions  = relationship("ComplianceException", back_populates="asset",
                               primaryjoin="and_(ComplianceException.asset_id==Asset.id, ComplianceException.revoked_at==None)",
                               lazy="select", viewonly=True)

    def active_exceptions(self):
        now = datetime.now(timezone.utc)
        return [e for e in self.exceptions
                if e.revoked_at is None and (e.expires_at is None or e.expires_at > now)]

    def exception_map(self):
        return {e.indicator: e for e in self.active_exceptions()}

    def to_dict(self, include_exceptions=True, detail=False):
        exc_map = self.exception_map() if include_exceptions else {}
        d = {
            "id": self.id, "name": self.name, "type": str(self.type).split(".")[-1] if self.type else None,
            "ips": self.ips or [], "mac_address": self.mac_address,
            "vendor": self.vendor, "source": self.source, "data_source_id": self.data_source_id,
            "edr_installed": self.edr_installed, "monitored": self.monitored,
            "siem_enabled": self.siem_enabled, "logs_enabled": self.logs_enabled,
            "monica_registered": self.monica_registered,
            "last_backup_local": self.last_backup_local.isoformat() if self.last_backup_local else None,
            "last_backup_cloud": self.last_backup_cloud.isoformat() if self.last_backup_cloud else None,
            "last_sync": self.last_sync.isoformat() if self.last_sync else None,
            "product_name": self.product_name, "product_version": self.product_version,
            "ram_gb": self.ram_gb, "total_disk_gb": self.total_disk_gb,
            "cpu_count": self.cpu_count, "os": self.os,
            "model": self.model, "port_count": self.port_count,
            "firmware_version": self.firmware_version, "max_speed": self.max_speed,
            "coverage_area": self.coverage_area, "connected_clients": self.connected_clients,
            "db_engine": self.db_engine, "db_version": self.db_version,
            "db_size_gb": self.db_size_gb, "db_host": self.db_host, "db_port": self.db_port,
            "db_replication": self.db_replication, "db_cluster": self.db_cluster,
            "db_is_cluster": self.db_is_cluster, "db_vip": self.db_vip,
            "db_host_asset_id": self.db_host_asset_id, "db_host_display": self.db_host_display,
            "vcenter_id": self.vcenter_id, "vcenter_name": self.vcenter_name,
            "hypervisor_id": self.hypervisor_id, "hypervisor_name": self.hypervisor_name,
            "vcenter_host": self.vcenter_host, "vcenter_datacenter": self.vcenter_datacenter,
            "vcenter_cluster": self.vcenter_cluster,
            "vm_guest_os": self.vm_guest_os, "vm_tools_version": self.vm_tools_version,
            "vm_cpu_reserved_mhz": self.vm_cpu_reserved_mhz, "vm_memory_reserved_mb": self.vm_memory_reserved_mb,
            "vm_datastore": self.vm_datastore, "vm_folder": self.vm_folder, "vm_power_state": self.vm_power_state,
            "vm_uuid": self.vm_uuid,
            "web_server_software": self.web_server_software, "web_server_version": self.web_server_version,
            "web_server_port": self.web_server_port, "web_listen_ips": self.web_listen_ips,
            "web_virtual_hosts": self.web_virtual_hosts, "web_ssl_enabled": self.web_ssl_enabled,
            "web_ssl_cert_cn": self.web_ssl_cert_cn,
            "web_ssl_cert_expiry": self.web_ssl_cert_expiry.isoformat() if self.web_ssl_cert_expiry else None,
            "web_ssl_cert_issuer": self.web_ssl_cert_issuer,
            "web_ssl_cert_san": self.web_ssl_cert_san,
            "web_ssl_cert_path": self.web_ssl_cert_path,
            "web_config_path": self.web_config_path,
            "host_asset_id": self.host_asset_id, "host_asset_name": self.host_asset_name,
            "fw_type": self.fw_type, "fw_policy_count": self.fw_policy_count,
            "fw_ha_mode": self.fw_ha_mode, "fw_nat_enabled": self.fw_nat_enabled,
            "fw_vpn_enabled": self.fw_vpn_enabled,
            "lb_software": self.lb_software, "lb_algorithm": self.lb_algorithm,
            "lb_virtual_servers": self.lb_virtual_servers, "lb_pool_members": self.lb_pool_members,
            "lb_ssl_offload": self.lb_ssl_offload,
            "storage_type": self.storage_type, "storage_protocol": self.storage_protocol,
            "storage_total_raw_tb": self.storage_total_raw_tb, "storage_usable_tb": self.storage_usable_tb,
            "storage_raid_level": self.storage_raid_level,
            "k8s_version": self.k8s_version, "k8s_provider": self.k8s_provider,
            "k8s_network_plugin": self.k8s_network_plugin, "k8s_ingress_class": self.k8s_ingress_class,
            "k8s_container_runtime": self.k8s_container_runtime, "k8s_storage_class": self.k8s_storage_class,
            "k8s_control_plane_count": self.k8s_control_plane_count, "k8s_worker_count": self.k8s_worker_count,
            "k8s_nodes": self.k8s_nodes, "k8s_namespaces": self.k8s_namespaces,
            "k8s_pods": self.k8s_pods, "k8s_deployments": self.k8s_deployments,
            "k8s_helm_releases": self.k8s_helm_releases,
            "container_runtime": self.container_runtime, "container_image": self.container_image,
            "container_image_tag": self.container_image_tag, "container_status": self.container_status,
            "container_ports": self.container_ports, "container_network": self.container_network,
            "container_volumes": self.container_volumes,
            "container_compose_project": self.container_compose_project,
            "container_compose_service": self.container_compose_service,
            "container_id": self.container_id,
            "backup_job_name": self.backup_job_name,
            "backup_cloud_job_name": self.backup_cloud_job_name,
            "backup_last_status": self.backup_last_status,
            "backup_restore_points": self.backup_restore_points,
            "edr_endpoint_id": self.edr_endpoint_id,
            "edr_health": self.edr_health,
            "edr_last_seen": self.edr_last_seen.isoformat() if self.edr_last_seen else None,
            "edr_tamper_protected": self.edr_tamper_protected,
            "edr_online": self.edr_online,
            "edr_agent_mode": self.edr_agent_mode,
            "edr_managed": self.edr_managed,
            "detected_services": self.detected_services,
            "serial_number": self.serial_number, "location": self.location, "cell_id": self.cell_id,
            "cell_full_path": self._get_cell_full_path(),
            "description": self.description,
            "notes": self.notes,
            "purchase_date": self.purchase_date.isoformat() if self.purchase_date else None,
            "warranty_expiry": self.warranty_expiry.isoformat() if self.warranty_expiry else None,
            "contributing_sources": self.contributing_sources or [],
            "created_by": self.created_by,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "tags": [{"id": t.id, "name": t.name, "color_code": t.color_code, "origin": t.origin} for t in self.tags],
            "exceptions": [_exc_mini(exc_map[k]) for k in exc_map] if include_exceptions else [],
        }
        if detail:
            d.update({
                "db_schemas": self.db_schemas,
                "db_users": self.db_users,
                "db_connections_max": self.db_connections_max,
                "db_connections_active": self.db_connections_active,
                "db_encoding": self.db_encoding,
                "db_timezone": self.db_timezone,
                "db_ha_mode": self.db_ha_mode,
                "db_ssl_enabled": self.db_ssl_enabled,
                "db_audit_enabled": self.db_audit_enabled,
                "db_last_vacuum": self.db_last_vacuum.isoformat() if self.db_last_vacuum else None,
                "db_notes": self.db_notes,
                "db_cluster_nodes": self.db_cluster_nodes,
            })
        return d

    def _get_cell_full_path(self):
        """Devuelve el full_path de la celda asignada, o None si no hay."""
        try:
            from sqlalchemy.orm import object_session
            sess = object_session(self)
            if sess and self.cell_id:
                from app.models.location import Cell
                cell = sess.query(Cell).filter_by(id=self.cell_id).first()
                if cell:
                    d = cell.to_dict()
                    return d.get("full_path") or cell.name
        except Exception:
            pass
        return None

def _exc_mini(e):
    return {"id": e.id, "indicator": e.indicator, "reason": e.reason,
            "created_by_name": e.created_by_name,
            "created_at": e.created_at.isoformat() if e.created_at else None,
            "expires_at": e.expires_at.isoformat() if e.expires_at else None}

class AssetHistory(Base):
    __tablename__ = "asset_history"
    id          = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    asset_id    = Column(String, nullable=False, index=True)
    snapshot_at = Column(DateTime(timezone=True), nullable=False, index=True)
    snapshot    = Column(JSON, nullable=False)
    created_at  = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class AssetChangeLog(Base):
    __tablename__ = "asset_change_log"
    id         = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    asset_id   = Column(String, nullable=False, index=True)
    field      = Column(String(100), nullable=False, index=True)
    old_value  = Column(JSON, nullable=True)
    new_value  = Column(JSON, nullable=True)
    changed_at = Column(DateTime(timezone=True), nullable=False,
                        default=lambda: datetime.now(timezone.utc), index=True)
    source     = Column(String(100), nullable=True)  # "ingest", "manual", "system"
