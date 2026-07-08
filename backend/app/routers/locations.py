from app.services.db_utils import db_op
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import Optional, List
from app.database import get_db
from app.middleware.auth import require_viewer, require_editor, require_admin
from app.models.location import Zone, Site, Cell
from app.models.audit import ActivityType
from app.services import audit_service

router = APIRouter()

# Pydantic bodies
class ZoneBody(BaseModel):
    name: str
    description: Optional[str] = None

class SiteBody(BaseModel):
    zone_id: str
    name: str
    address: Optional[str] = None
    description: Optional[str] = None

class CellBody(BaseModel):
    site_id: str
    name: str
    cell_type: Optional[str] = None
    row_id: Optional[str] = None
    rack_unit: Optional[str] = None
    description: Optional[str] = None

class BulkAssignBody(BaseModel):
    asset_ids: List[str]
    cell_id: Optional[str] = None   # None = desvincular

# Zones
@router.get("/v1/locations/tree")
def get_tree(db: Session = Depends(get_db), user=Depends(require_viewer)):
    zones = db.query(Zone).order_by(Zone.name).all()
    return [z.to_dict(include_sites=True) for z in zones]

@router.get("/v1/zones")
def list_zones(db: Session = Depends(get_db), user=Depends(require_viewer)):
    return [z.to_dict() for z in db.query(Zone).order_by(Zone.name).all()]

@router.post("/v1/zones", status_code=201)
def create_zone(body: ZoneBody, db: Session = Depends(get_db), user=Depends(require_editor)):
    try:
        z = Zone(**body.model_dump())
        db.add(z); db.flush()
        audit_service.record(db, ActivityType.CREATE, user=user, entity_type="zone", entity_id=z.id, entity_name=z.name, after=z.to_dict())
        db.commit(); db.refresh(z)
        return z.to_dict()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, f"Ya existe una zona con el nombre '{body.name}'")

@router.put("/v1/zones/{zone_id}")
def update_zone(zone_id: str, body: ZoneBody, db: Session = Depends(get_db), user=Depends(require_editor)):
    z = db.query(Zone).filter_by(id=zone_id).first()
    if not z: raise HTTPException(404, "Zone not found")
    before = z.to_dict()
    with db_op(db, conflict_msg="Ya existe una zona con ese nombre"):
        for k, v in body.dict(exclude_unset=True).items(): setattr(z, k, v)
        audit_service.record(db, ActivityType.UPDATE, user=user, entity_type="zone", entity_id=z.id, entity_name=z.name, before=before, after=z.to_dict())
        db.commit(); db.refresh(z)
    return z.to_dict()

@router.delete("/v1/zones/{zone_id}", status_code=204)
def delete_zone(zone_id: str, db: Session = Depends(get_db), user=Depends(require_editor)):
    z = db.query(Zone).filter_by(id=zone_id).first()
    if not z: raise HTTPException(404, "Zone not found")
    with db_op(db, conflict_msg="No se puede eliminar: tiene sites asociados"):
        audit_service.record(db, ActivityType.DELETE, user=user, entity_type="zone", entity_id=z.id, entity_name=z.name, before=z.to_dict())
        db.delete(z); db.commit()

# Sites
@router.get("/v1/sites")
def list_sites(zone_id: Optional[str] = None, db: Session = Depends(get_db), user=Depends(require_viewer)):
    q = db.query(Site)
    if zone_id: q = q.filter_by(zone_id=zone_id)
    return [s.to_dict() for s in q.order_by(Site.name).all()]

@router.post("/v1/sites", status_code=201)
def create_site(body: SiteBody, db: Session = Depends(get_db), user=Depends(require_editor)):
    z = db.query(Zone).filter_by(id=body.zone_id).first()
    if not z: raise HTTPException(404, "Zone not found")
    try:
        s = Site(**body.model_dump())
        db.add(s); db.flush()
        audit_service.record(db, ActivityType.CREATE, user=user, entity_type="site", entity_id=s.id, entity_name=s.name, after=s.to_dict())
        db.commit(); db.refresh(s)
        return s.to_dict()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, f"Ya existe una localización con ese nombre en esta zona")

@router.put("/v1/sites/{site_id}")
def update_site(site_id: str, body: SiteBody, db: Session = Depends(get_db), user=Depends(require_editor)):
    s = db.query(Site).filter_by(id=site_id).first()
    if not s: raise HTTPException(404, "Site not found")
    before = s.to_dict()
    with db_op(db, conflict_msg="Ya existe una localización con ese nombre"):
        for k, v in body.dict(exclude_unset=True).items(): setattr(s, k, v)
        audit_service.record(db, ActivityType.UPDATE, user=user, entity_type="site", entity_id=s.id, entity_name=s.name, before=before, after=s.to_dict())
        db.commit(); db.refresh(s)
    return s.to_dict()

@router.delete("/v1/sites/{site_id}", status_code=204)
def delete_site(site_id: str, db: Session = Depends(get_db), user=Depends(require_editor)):
    s = db.query(Site).filter_by(id=site_id).first()
    if not s: raise HTTPException(404, "Site not found")
    with db_op(db, conflict_msg="No se puede eliminar: tiene celdas o activos asociados"):
        audit_service.record(db, ActivityType.DELETE, user=user, entity_type="site", entity_id=s.id, entity_name=s.name, before=s.to_dict())
        db.delete(s); db.commit()

# Cells
@router.get("/v1/cells")
def list_cells(site_id: Optional[str] = None, db: Session = Depends(get_db), user=Depends(require_viewer)):
    q = db.query(Cell)
    if site_id: q = q.filter_by(site_id=site_id)
    return [c.to_dict() for c in q.order_by(Cell.name).all()]

@router.post("/v1/cells", status_code=201)
def create_cell(body: CellBody, db: Session = Depends(get_db), user=Depends(require_editor)):
    s = db.query(Site).filter_by(id=body.site_id).first()
    if not s: raise HTTPException(404, "Site not found")
    with db_op(db, conflict_msg="Ya existe una celda con ese nombre en este site"):
        cell = Cell(**body.model_dump())
        db.add(cell); db.flush()
        audit_service.record(db, ActivityType.CREATE, user=user, entity_type="cell", entity_id=cell.id, entity_name=cell.name, after=cell.to_dict())
        db.commit(); db.refresh(cell)
    return cell.to_dict()

@router.put("/v1/cells/{cell_id}")
def update_cell(cell_id: str, body: CellBody, db: Session = Depends(get_db), user=Depends(require_editor)):
    cell = db.query(Cell).filter_by(id=cell_id).first()
    if not cell: raise HTTPException(404, "Cell not found")
    before = cell.to_dict()
    with db_op(db, conflict_msg="Ya existe una celda con ese nombre"):
        for k, v in body.dict(exclude_unset=True).items(): setattr(cell, k, v)
        audit_service.record(db, ActivityType.UPDATE, user=user, entity_type="cell", entity_id=cell.id, entity_name=cell.name, before=before, after=cell.to_dict())
        db.commit(); db.refresh(cell)
    return cell.to_dict()

@router.delete("/v1/cells/{cell_id}", status_code=204)
def delete_cell(cell_id: str, db: Session = Depends(get_db), user=Depends(require_editor)):
    cell = db.query(Cell).filter_by(id=cell_id).first()
    if not cell: raise HTTPException(404, "Cell not found")
    with db_op(db, conflict_msg="No se puede eliminar: tiene activos asociados"):
        audit_service.record(db, ActivityType.DELETE, user=user, entity_type="cell", entity_id=cell.id, entity_name=cell.name, before=cell.to_dict())
        db.delete(cell); db.commit()

# Bulk assign assets to cell
@router.post("/v1/cells/bulk-assign", status_code=200)
def bulk_assign(body: BulkAssignBody, db: Session = Depends(get_db), user=Depends(require_editor)):
    from app.models.asset import Asset
    if body.cell_id:
        cell = db.query(Cell).filter_by(id=body.cell_id).first()
        if not cell: raise HTTPException(404, "Cell not found")
    updated = 0
    for asset_id in body.asset_ids:
        asset = db.query(Asset).filter_by(id=asset_id).first()
        if asset:
            asset.cell_id = body.cell_id
            updated += 1
    if updated > 0:
        cell_name = cell.name if body.cell_id else "sin asignar"
        audit_service.record(db, ActivityType.LOCATION_ASSIGN, user=user,
            entity_type="cell", entity_id=body.cell_id, entity_name=cell_name,
            after={"asset_ids": body.asset_ids, "updated": updated})
    db.commit()
    return {"updated": updated, "cell_id": body.cell_id}

@router.get("/v1/cells/{cell_id}/assets")
def cell_assets(cell_id: str, db: Session = Depends(get_db), user=Depends(require_viewer)):
    from app.models.asset import Asset
    assets = db.query(Asset).filter_by(cell_id=cell_id).all()
    return [{"id": a.id, "name": a.name,
             "type": str(a.type).split(".")[-1] if a.type else None,
             "ips": a.ips or [], "vendor": a.vendor} for a in assets]
