from app.services.db_utils import db_op
import logging
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload
from app.database import get_db
from app.middleware.auth import require_admin, require_editor, require_viewer
from app.models.application import (Application, Service, ServiceEndpoint, ServiceComponent,
    AppInfraBinding, AppDependency, AppEnvironment, AppStatus, ServiceStatus, ServiceCriticality,
    ServiceCategory, ComponentRole, BindingType, BindingTier, DepType, EndpointType)
from app.models.asset import Asset
from app.models.audit import ActivityType
from app.services import audit_service

logger = logging.getLogger("tfg.applications")
router = APIRouter(tags=["Applications & Services"])

# Pydantic models
class AppCreate(BaseModel):
    name: str = Field(..., max_length=200)
    description: Optional[str] = None
    version: Optional[str] = Field(None, max_length=50)
    repo_url: Optional[str] = Field(None, max_length=500)
    docs_url: Optional[str] = Field(None, max_length=500)
    tech_stack: Optional[List[str]] = []
    owner_team: Optional[str] = Field(None, max_length=100)
    environment: AppEnvironment = AppEnvironment.production
    status: AppStatus = AppStatus.active

class SvcCreate(BaseModel):
    name: str = Field(..., max_length=200)
    description: Optional[str] = None
    category: Optional[ServiceCategory] = ServiceCategory.internal_tool
    status: ServiceStatus = ServiceStatus.active
    criticality: ServiceCriticality = ServiceCriticality.medium
    owner_team: Optional[str] = Field(None, max_length=100)

class EndpointCreate(BaseModel):
    url: str = Field(..., max_length=500)
    type: EndpointType = EndpointType.public
    description: Optional[str] = Field(None, max_length=200)
    is_primary: bool = False

class ComponentCreate(BaseModel):
    application_id: str
    role: ComponentRole = ComponentRole.backend
    role_notes: Optional[str] = Field(None, max_length=200)
    order_index: int = 0

class BindingCreate(BaseModel):
    asset_id: str
    binding_tier: BindingTier = BindingTier.compute
    tier_order_override: Optional[int] = None
    is_critical: bool = True
    is_single_point_of_failure: bool = False
    redundancy_group: Optional[str] = None
    communication_port: Optional[int] = None
    notes: Optional[str] = None

class BindingUpdate(BaseModel):
    """Editar binding existente — asset_id no es editable."""
    binding_tier: Optional[BindingTier] = None
    tier_order_override: Optional[int] = None
    is_critical: Optional[bool] = None
    is_single_point_of_failure: Optional[bool] = None
    redundancy_group: Optional[str] = None
    communication_port: Optional[int] = None
    notes: Optional[str] = None

class DepCreate(BaseModel):
    target_app_id: str
    dep_type: DepType
    is_critical: bool = True
    notes: Optional[str] = Field(None, max_length=200)

# DAG cycle detection
def would_create_cycle(db: Session, source_id: str, target_id: str) -> bool:
    if source_id == target_id: return True
    visited = set(); queue = [target_id]
    while queue:
        current = queue.pop()
        if current == source_id: return True
        if current in visited: continue
        visited.add(current)
        deps = db.query(AppDependency.target_app_id).filter_by(source_app_id=current).all()
        queue.extend([d.target_app_id for d in deps])
    return False

# Applications
@router.get("/v1/applications")
def list_applications(search: Optional[str]=Query(None,max_length=200), status: Optional[AppStatus]=None, environment: Optional[AppEnvironment]=None,
    page: int=Query(1,ge=1), page_size: int=Query(50,ge=1,le=200), db: Session=Depends(get_db), user: dict=Depends(require_viewer)):
    q = db.query(Application)
    if status: q = q.filter_by(status=status)
    if environment: q = q.filter_by(environment=environment)
    if search:
        t = f"%{search}%"
        from sqlalchemy import cast, String
        q = q.filter(Application.name.ilike(t) | Application.owner_team.ilike(t) | cast(Application.tech_stack, String).ilike(t))
    total = q.count()
    items = q.order_by(Application.name).offset((page-1)*page_size).limit(page_size).all()
    def enrich_app(a):
        d = a.to_dict()
        if a.cell_id:
            from app.models.location import Cell
            cell = db.query(Cell).filter_by(id=a.cell_id).first()
            d['cell_name'] = cell.name if cell else None
            d['location_path'] = cell._full_path() if cell else None
        else:
            d['cell_name'] = None
            d['location_path'] = None
        return d
    return {"data":[enrich_app(a) for a in items],"total":total,"page":page,"page_size":page_size}

@router.get("/v1/applications/{app_id}")
def get_application(app_id: str, db: Session=Depends(get_db), user: dict=Depends(require_viewer)):
    app = db.query(Application).options(joinedload(Application.infra_bindings),joinedload(Application.outgoing_deps).joinedload(AppDependency.target_app),joinedload(Application.incoming_deps).joinedload(AppDependency.source_app)).filter_by(id=app_id).first()
    if not app: raise HTTPException(404,"Application not found")
    d = app.to_dict()
    d["infra_bindings"] = [b.to_dict() for b in app.infra_bindings]
    d["outgoing_deps"]  = [dep.to_dict() for dep in app.outgoing_deps]
    d["incoming_deps"]  = [dep.to_dict() for dep in app.incoming_deps]
    return d

@router.post("/v1/applications", status_code=201)
def create_application(req: Request, body: AppCreate, db: Session=Depends(get_db), user: dict=Depends(require_editor)):
    if db.query(Application).filter_by(name=body.name).first(): raise HTTPException(409,"Application name already exists")
    app = Application(**body.model_dump()); db.add(app); db.flush()
    audit_service.record(db,ActivityType.CREATE,user=user,entity_type="application",entity_id=app.id,entity_name=app.name,after=app.to_dict(),ip_address=req.client.host if req.client else None)
    db.commit(); db.refresh(app); return app.to_dict()

@router.put("/v1/applications/{app_id}")
def update_application(req: Request, app_id: str, body: AppCreate, db: Session=Depends(get_db), user: dict=Depends(require_editor)):
    app = db.query(Application).filter_by(id=app_id).first()
    if not app: raise HTTPException(404,"Application not found")
    before = app.to_dict()
    for k,v in body.model_dump().items(): setattr(app,k,v)
    audit_service.record(db,ActivityType.UPDATE,user=user,entity_type="application",entity_id=app.id,entity_name=app.name,before=before,after=app.to_dict(),ip_address=req.client.host if req.client else None)
    db.commit(); db.refresh(app); return app.to_dict()

@router.delete("/v1/applications/{app_id}")
def delete_application(req: Request, app_id: str, db: Session=Depends(get_db), user: dict=Depends(require_editor)):
    app = db.query(Application).filter_by(id=app_id).first()
    if not app: raise HTTPException(404,"Application not found")
    active_svcs = db.query(ServiceComponent).filter_by(application_id=app_id).all()
    if active_svcs:
        names = [sc.service.name if sc.service else sc.service_id for sc in active_svcs]
        raise HTTPException(409,f"Application is part of active services: {names}")
    audit_service.record(db,ActivityType.DELETE,user=user,entity_type="application",entity_id=app.id,entity_name=app.name,before=app.to_dict(),ip_address=req.client.host if req.client else None)
    db.delete(app); db.commit(); return {"deleted":app_id}

# Infra bindings
@router.get("/v1/applications/{app_id}/infra-bindings")
def list_bindings(app_id: str, db: Session=Depends(get_db), user: dict=Depends(require_viewer)):
    from sqlalchemy.orm import joinedload as jl
    from app.models.asset import Asset
    bindings = db.query(AppInfraBinding).filter_by(application_id=app_id).all()
    result = []
    for b in bindings:
        d = b.to_dict()
        if b.asset_id:
            asset = db.query(Asset).filter_by(id=b.asset_id).first()
            if asset:
                d["asset_name"] = asset.name
                d["asset_type"] = str(asset.type).split(".")[-1] if asset.type else None
                d["asset_ips"]  = asset.ips or []
        result.append(d)
    return result

@router.post("/v1/applications/{app_id}/infra-bindings", status_code=201)
def add_binding(app_id: str, body: BindingCreate, db: Session=Depends(get_db), user: dict=Depends(require_editor)):
    if not db.query(Application).filter_by(id=app_id).first(): raise HTTPException(404,"Application not found")
    if not db.query(Asset).filter_by(id=body.asset_id).first(): raise HTTPException(404,"Asset not found")
    b = AppInfraBinding(
        application_id=app_id,
        asset_id=body.asset_id,
        binding_tier=body.binding_tier,
        tier_order_override=body.tier_order_override,
        is_critical=body.is_critical,
        is_single_point_of_failure=body.is_single_point_of_failure,
        redundancy_group=body.redundancy_group,
        notes=body.notes,
    )
    db.add(b); db.flush()
    app = db.query(Application).filter_by(id=app_id).first()
    # Enriquecer con nombre del asset
    _ast = db.query(Asset).filter_by(id=body.asset_id).first()
    audit_service.record(db,ActivityType.INFRA_BIND,user=user,entity_type="application",
        entity_id=app_id,entity_name=app.name if app else app_id,
        after={"asset_id":body.asset_id,
               "asset_name":_ast.name if _ast else body.asset_id,
               "tier":str(body.binding_tier).split(".")[-1] if body.binding_tier else None,
               "communication_port":body.communication_port,
               "is_critical":body.is_critical})
    db.commit(); db.refresh(b)
    return b.to_dict()

@router.put("/v1/applications/{app_id}/infra-bindings/{bid}")
def update_binding(app_id: str, bid: str, body: BindingUpdate,
                   db: Session=Depends(get_db), user: dict=Depends(require_editor)):
    """Editar un infra-binding existente (tier, puerto, criticidad, notas...)."""
    b = db.query(AppInfraBinding).filter_by(id=bid, application_id=app_id).first()
    if not b: raise HTTPException(404, "Binding not found")
    before = b.to_dict()
    if body.binding_tier               is not None: b.binding_tier               = body.binding_tier
    if body.tier_order_override        is not None: b.tier_order_override        = body.tier_order_override
    if body.is_critical                is not None: b.is_critical                = body.is_critical
    if body.is_single_point_of_failure is not None: b.is_single_point_of_failure = body.is_single_point_of_failure
    if body.redundancy_group           is not None: b.redundancy_group           = body.redundancy_group
    if body.communication_port         is not None: b.communication_port         = body.communication_port
    if body.notes                      is not None: b.notes                      = body.notes
    app = db.query(Application).filter_by(id=app_id).first()
    audit_service.record(db, ActivityType.INFRA_BIND, user=user, entity_type="application",
        entity_id=app_id, entity_name=app.name if app else app_id, before=before, after=b.to_dict())
    db.commit(); db.refresh(b)
    return b.to_dict()

@router.delete("/v1/applications/{app_id}/infra-bindings/{bid}")
def remove_binding(app_id: str, bid: str, db: Session=Depends(get_db), user: dict=Depends(require_editor)):
    b = db.query(AppInfraBinding).filter_by(id=bid,application_id=app_id).first()
    if not b: raise HTTPException(404,"Binding not found")
    app = db.query(Application).filter_by(id=app_id).first()
    audit_service.record(db,ActivityType.INFRA_UNBIND,user=user,entity_type="application",
        entity_id=app_id,entity_name=app.name if app else app_id,
        before={"binding_id":bid,"asset_id":b.asset_id})
    db.delete(b); db.commit(); return {"deleted":bid}

# Dependencies
@router.get("/v1/applications/{app_id}/dependencies")
def list_deps(app_id: str, db: Session=Depends(get_db), user: dict=Depends(require_viewer)):
    out = [d.to_dict() for d in db.query(AppDependency).filter_by(source_app_id=app_id).all()]
    inc = [d.to_dict() for d in db.query(AppDependency).filter_by(target_app_id=app_id).all()]
    return {"outgoing":out,"incoming":inc}

@router.post("/v1/applications/{app_id}/dependencies", status_code=201)
def add_dep(app_id: str, body: DepCreate, db: Session=Depends(get_db), user: dict=Depends(require_editor)):
    if app_id == body.target_app_id: raise HTTPException(422,"An application cannot depend on itself")
    if not db.query(Application).filter_by(id=body.target_app_id).first(): raise HTTPException(404,"Target application not found")
    if would_create_cycle(db, app_id, body.target_app_id): raise HTTPException(409,"Dependency cycle detected")
    dep = AppDependency(source_app_id=app_id,**body.model_dump()); db.add(dep); db.flush()
    app = db.query(Application).filter_by(id=app_id).first()
    _tgt = db.query(Application).filter_by(id=body.target_app_id).first()
    audit_service.record(db,ActivityType.DEPENDENCY_ADD,user=user,entity_type="application",
        entity_id=app_id,entity_name=app.name if app else app_id,
        after={"target_app_id":body.target_app_id,
               "target_app_name":_tgt.name if _tgt else body.target_app_id,
               "dep_type":str(body.dep_type).split(".")[-1] if body.dep_type else None})
    db.commit(); db.refresh(dep); return dep.to_dict()

@router.delete("/v1/applications/{app_id}/dependencies/{did}")
def remove_dep(app_id: str, did: str, db: Session=Depends(get_db), user: dict=Depends(require_editor)):
    d = db.query(AppDependency).filter_by(id=did,source_app_id=app_id).first()
    if not d: raise HTTPException(404,"Dependency not found")
    app = db.query(Application).filter_by(id=app_id).first()
    audit_service.record(db,ActivityType.DEPENDENCY_REMOVE,user=user,entity_type="application",
        entity_id=app_id,entity_name=app.name if app else app_id,
        before={"dep_id":did,"target_app_id":d.target_app_id})
    db.delete(d); db.commit(); return {"deleted":did}

# Services
@router.get("/v1/services")
def list_services(search: Optional[str]=None, status: Optional[ServiceStatus]=None, criticality: Optional[ServiceCriticality]=None,
    page: int=Query(1,ge=1), page_size: int=Query(50,ge=1,le=200), db: Session=Depends(get_db), user: dict=Depends(require_viewer)):
    q = db.query(Service).options(joinedload(Service.endpoints),joinedload(Service.components))
    if status: q = q.filter_by(status=status)
    if criticality: q = q.filter_by(criticality=criticality)
    if search: q = q.filter(Service.name.ilike(f"%{search}%"))
    total = q.count(); items = q.order_by(Service.name).offset((page-1)*page_size).limit(page_size).all()
    return {"data":[s.to_dict() for s in items],"total":total}

@router.get("/v1/services/{svc_id}")
def get_service(svc_id: str, db: Session=Depends(get_db), user: dict=Depends(require_viewer)):
    svc = db.query(Service).options(joinedload(Service.endpoints),joinedload(Service.components).joinedload(ServiceComponent.application)).filter_by(id=svc_id).first()
    if not svc: raise HTTPException(404,"Service not found")
    return svc.to_dict()

@router.post("/v1/services", status_code=201)
def create_service(req: Request, body: SvcCreate, db: Session=Depends(get_db), user: dict=Depends(require_editor)):
    if db.query(Service).filter_by(name=body.name).first(): raise HTTPException(409,"Service name already exists")
    svc = Service(**body.model_dump()); db.add(svc); db.flush()
    audit_service.record(db,ActivityType.CREATE,user=user,entity_type="service",entity_id=svc.id,entity_name=svc.name,after=svc.to_dict(),ip_address=req.client.host if req.client else None)
    db.commit(); db.refresh(svc); return svc.to_dict()

@router.put("/v1/services/{svc_id}")
def update_service(req: Request, svc_id: str, body: SvcCreate, db: Session=Depends(get_db), user: dict=Depends(require_editor)):
    svc = db.query(Service).filter_by(id=svc_id).first()
    if not svc: raise HTTPException(404,"Service not found")
    before = svc.to_dict()
    for k,v in body.model_dump().items(): setattr(svc,k,v)
    audit_service.record(db,ActivityType.UPDATE,user=user,entity_type="service",entity_id=svc.id,entity_name=svc.name,before=before,after=svc.to_dict(),ip_address=req.client.host if req.client else None)
    db.commit(); db.refresh(svc); return svc.to_dict()

@router.delete("/v1/services/{svc_id}")
def delete_service(svc_id: str, db: Session=Depends(get_db), user: dict=Depends(require_editor)):
    svc = db.query(Service).filter_by(id=svc_id).first()
    if not svc: raise HTTPException(404,"Service not found")
    db.delete(svc); db.commit(); return {"deleted":svc_id}

# Service endpoints
@router.post("/v1/services/{svc_id}/endpoints", status_code=201)
def add_endpoint(svc_id: str, body: EndpointCreate, db: Session=Depends(get_db), user: dict=Depends(require_editor)):
    if not db.query(Service).filter_by(id=svc_id).first(): raise HTTPException(404,"Service not found")
    if body.is_primary:
        db.query(ServiceEndpoint).filter_by(service_id=svc_id,is_primary=True).update({"is_primary":False})
    svc = db.query(Service).filter_by(id=svc_id).first()
    ep = ServiceEndpoint(service_id=svc_id,**body.model_dump()); db.add(ep); db.flush()
    audit_service.record(db,ActivityType.ENDPOINT_ADD,user=user,entity_type="service",entity_id=svc_id,entity_name=svc.name if svc else svc_id,after={"url":body.url,"type":str(body.type).split(".")[-1] if body.type else None})
    db.commit(); db.refresh(ep); return ep.to_dict()

@router.delete("/v1/services/{svc_id}/endpoints/{eid}")
def remove_endpoint(svc_id: str, eid: str, db: Session=Depends(get_db), user: dict=Depends(require_editor)):
    ep = db.query(ServiceEndpoint).filter_by(id=eid,service_id=svc_id).first()
    if not ep: raise HTTPException(404,"Endpoint not found")
    audit_service.record(db,ActivityType.ENDPOINT_REMOVE,user=user,entity_type="service",entity_id=svc_id,before={"endpoint_id":eid,"url":ep.url})
    db.delete(ep); db.commit(); return {"deleted":eid}

# Service components
@router.post("/v1/services/{svc_id}/components", status_code=201)
def add_component(svc_id: str, body: ComponentCreate, db: Session=Depends(get_db), user: dict=Depends(require_editor)):
    if not db.query(Service).filter_by(id=svc_id).first(): raise HTTPException(404,"Service not found")
    if not db.query(Application).filter_by(id=body.application_id).first(): raise HTTPException(404,"Application not found")
    if db.query(ServiceComponent).filter_by(service_id=svc_id,application_id=body.application_id).first(): raise HTTPException(409,"Application already part of this service")
    if body.role == ComponentRole.other and not body.role_notes: raise HTTPException(422,"role_notes is required when role is 'other'")
    svc = db.query(Service).filter_by(id=svc_id).first()
    sc = ServiceComponent(service_id=svc_id,**body.model_dump()); db.add(sc); db.flush()
    audit_service.record(db,ActivityType.COMPONENT_ADD,user=user,entity_type="service",entity_id=svc_id,entity_name=svc.name if svc else svc_id,after={"application_id":body.application_id,"role":str(body.role).split(".")[-1]})
    db.commit()
    return db.query(ServiceComponent).options(joinedload(ServiceComponent.application)).filter_by(id=sc.id).first().to_dict()

@router.delete("/v1/services/{svc_id}/components/{cid}")
def remove_component(svc_id: str, cid: str, db: Session=Depends(get_db), user: dict=Depends(require_editor)):
    sc = db.query(ServiceComponent).filter_by(id=cid,service_id=svc_id).first()
    if not sc: raise HTTPException(404,"Component not found")
    svc = db.query(Service).filter_by(id=svc_id).first()
    audit_service.record(db,ActivityType.COMPONENT_REMOVE,user=user,entity_type="service",entity_id=svc_id,entity_name=svc.name if svc else svc_id,before={"component_id":cid,"application_id":sc.application_id})
    db.delete(sc); db.commit(); return {"deleted":cid}

# Dependency graphs

def _get_location_info(db, cell_id):
    """Devuelve información estructurada de localización de una celda."""
    if not db or not cell_id:
        return None
    try:
        from app.models.location import Cell
        cell = db.query(Cell).filter_by(id=cell_id).first()
        if not cell:
            return None
        d = cell.to_dict()
        return {
            "cell_name":  cell.name,
            "cell_type":  cell.cell_type or "other",
            "row_id":     cell.row_id,
            "rack_unit":  cell.rack_unit,
            "site_name":  cell.site.name if cell.site else None,
            "zone_name":  cell.site.zone.name if (cell.site and cell.site.zone) else None,
            "full_path":  d.get("full_path", cell.name),
        }
    except Exception:
        return None

def _build_graph(services, include_assets=True, db=None):
    nodes, edges = {}, []
    for svc in services:
        sid = f"svc-{svc.id}"
        nodes[sid] = {"id":sid,"node_type":"service","label":svc.name,
                             "status":str(svc.status).split(".")[-1],
                             "criticality":str(svc.criticality).split(".")[-1],
                             "endpoints":[e.url for e in svc.endpoints]}
        for comp in svc.components:
            app = comp.application
            if not app: continue
            aid = f"app-{app.id}"
            if aid not in nodes:
                loc_info = _get_location_info(db, app.cell_id)
                nodes[aid] = {"id":aid,"node_type":"application","label":app.name,
                              "status":str(app.status).split(".")[-1],"environment":str(app.environment).split(".")[-1],
                              "version":app.version,"tech_stack":app.tech_stack or [],
                              "location_name": loc_info["full_path"] if loc_info else "",
                              "location_info": loc_info}
            edges.append({"id":f"e-{comp.id}","source":sid,"target":aid,"edge_type":"COMPOSED_OF","label":str(comp.role).split(".")[-1],"is_critical":True})
            for dep in app.outgoing_deps:
                t = dep.target_app
                if not t: continue
                tid = f"app-{t.id}"
                if tid not in nodes:
                    dep_loc = _get_location_info(db, t.cell_id)
                    nodes[tid] = {"id":tid,"node_type":"application","label":t.name,
                                  "status":str(t.status).split(".")[-1],"environment":str(t.environment).split(".")[-1],
                                  "version":t.version,"tech_stack":t.tech_stack or [],
                                  "location_name": dep_loc["full_path"] if dep_loc else "",
                                  "location_info": dep_loc}
                edges.append({"id":f"e-dep-{dep.id}","source":aid,"target":tid,"edge_type":"DEPENDS_ON","label":str(dep.dep_type).split(".")[-1],"is_critical":dep.is_critical})
            if include_assets:
                for b in app.infra_bindings:
                    if not b.asset_id: continue
                    astid = f"ast-{b.asset_id}"
                    if astid not in nodes:
                        tier_key = str(b.binding_tier).split(".")[-1] if b.binding_tier else "compute"
                        ast_name, ast_type, ast_ips = b.asset_id, "unknown", []
                        if db:
                            from app.models.asset import Asset as AssetModel
                            ast = db.query(AssetModel).filter_by(id=b.asset_id).first()
                            if ast:
                                ast_name = ast.name
                                ast_type = str(ast.type).split(".")[-1] if ast.type else "unknown"
                                ast_ips  = ast.ips or []
                        ast_loc = _get_location_info(db, ast.cell_id if ast else None)
                        nodes[astid] = {"id":astid,"node_type":"asset","label":ast_name,
                                        "asset_type":ast_type,"ips":ast_ips,
                                        "binding_tier":tier_key,"tier_order":b.tier_order_effective,
                                        "is_critical":b.is_critical,"is_single_point_of_failure":b.is_single_point_of_failure,
                                        "communication_port":b.communication_port,
                                        "notes":b.notes,
                                        "redundancy_group":b.redundancy_group,
                                        "location_name": ast_loc["full_path"] if ast_loc else "",
                                        "location_info": ast_loc}
                    tier_key = str(b.binding_tier).split(".")[-1] if b.binding_tier else "hosted_on"
                    edge_label = tier_key.replace("_"," ")
                    if b.communication_port:
                        edge_label = f"{edge_label} :{b.communication_port}"
                    edges.append({"id":f"e-bind-{b.id}","source":aid,"target":astid,
                                  "edge_type":"HOSTED_ON","label":edge_label,
                                  "is_critical":b.is_critical,
                                  "communication_port":b.communication_port})
    return {"nodes":list(nodes.values()),"edges":edges}

@router.get("/v1/services/{svc_id}/dependency-graph")
def service_graph(svc_id: str, include_assets: bool=True, db: Session=Depends(get_db), user: dict=Depends(require_viewer)):
    svc = db.query(Service).options(joinedload(Service.endpoints),joinedload(Service.components).joinedload(ServiceComponent.application).joinedload(Application.outgoing_deps).joinedload(AppDependency.target_app),joinedload(Service.components).joinedload(ServiceComponent.application).joinedload(Application.infra_bindings)).filter_by(id=svc_id).first()
    if not svc: raise HTTPException(404,"Service not found")
    return _build_graph([svc], include_assets, db)

@router.get("/v1/dependency-graph")
def global_graph(include_assets: bool=True, include_inactive: bool=False, db: Session=Depends(get_db), user: dict=Depends(require_viewer)):
    q = db.query(Service).options(joinedload(Service.endpoints),joinedload(Service.components).joinedload(ServiceComponent.application).joinedload(Application.outgoing_deps).joinedload(AppDependency.target_app),joinedload(Service.components).joinedload(ServiceComponent.application).joinedload(Application.infra_bindings))
    if not include_inactive: q = q.filter(Service.status.in_(["active","degraded"]))
    return _build_graph(q.all(), include_assets, db)
