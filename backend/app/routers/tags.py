from app.services.db_utils import db_op
import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from app.database import get_db
from app.middleware.auth import require_admin, require_viewer
from app.models.tag import Tag, TagOrigin
from app.services import audit_service
from app.models.audit import ActivityType

logger = logging.getLogger("tfg.tags")
router = APIRouter(prefix="/v1/tags", tags=["Tags"])

class TagCreate(BaseModel):
    name:        str = Field(..., min_length=1, max_length=100)
    color_code:  str = Field("#6366f1", pattern=r"^#[0-9a-fA-F]{6}$")
    description: Optional[str] = Field(None, max_length=255)

class TagUpdate(BaseModel):
    name:        Optional[str] = Field(None, min_length=1, max_length=100)
    color_code:  Optional[str] = Field(None, pattern=r"^#[0-9a-fA-F]{6}$")
    description: Optional[str] = Field(None, max_length=255)

def _d(tag: Tag):
    return {"id": tag.id, "name": tag.name, "color_code": tag.color_code,
            "description": tag.description, "origin": tag.origin,
            "created_by": tag.created_by, "asset_count": len(tag.assets),
            "created_at": tag.created_at.isoformat() if tag.created_at else None}

def _guard(tag: Tag):
    if tag.origin == TagOrigin.system:
        raise HTTPException(400, "Cannot modify or delete system tags")

@router.get("")
def list_tags(origin: Optional[TagOrigin] = None, db: Session = Depends(get_db), user=Depends(require_viewer)):
    q = db.query(Tag)
    if origin: q = q.filter(Tag.origin == origin)
    return [_d(t) for t in q.order_by(Tag.name).all()]

@router.post("", status_code=201)
def create_tag(request: Request, body: TagCreate, db: Session = Depends(get_db), user=Depends(require_admin)):
    if db.query(Tag).filter_by(name=body.name).first():
        raise HTTPException(409, f"Tag '{body.name}' already exists")
    tag = Tag(name=body.name, color_code=body.color_code, description=body.description,
              origin=TagOrigin.manual, created_by=user.get("preferred_username"))
    with db_op(db, conflict_msg="Ya existe una etiqueta con ese nombre"):
      db.add(tag); db.flush()
      audit_service.record(db, ActivityType.CREATE, user=user, entity_type="tag",
        entity_id=tag.id, entity_name=tag.name, after=_d(tag),
        ip_address=request.client.host if request.client else None)
    db.commit(); db.refresh(tag)
    return _d(tag)

@router.put("/{tag_id}")
def update_tag(request: Request, tag_id: str, body: TagUpdate, db: Session = Depends(get_db), user=Depends(require_admin)):
    tag = db.query(Tag).filter_by(id=tag_id).first()
    if not tag: raise HTTPException(404, "Tag not found")
    _guard(tag)
    before = _d(tag)
    if body.name:
        if db.query(Tag).filter(Tag.name == body.name, Tag.id != tag_id).first():
            raise HTTPException(409, f"Tag '{body.name}' already exists")
        tag.name = body.name
    if body.color_code: tag.color_code = body.color_code
    if body.description is not None: tag.description = body.description
    audit_service.record(db, ActivityType.UPDATE, user=user, entity_type="tag",
        entity_id=tag.id, entity_name=tag.name, before=before, after=_d(tag),
        ip_address=request.client.host if request.client else None)
    db.commit(); db.refresh(tag)
    return _d(tag)

@router.delete("/{tag_id}", status_code=204)
def delete_tag(request: Request, tag_id: str, db: Session = Depends(get_db), user=Depends(require_admin)):
    tag = db.query(Tag).filter_by(id=tag_id).first()
    if not tag: raise HTTPException(404, "Tag not found")
    _guard(tag)
    audit_service.record(db, ActivityType.DELETE, user=user, entity_type="tag",
        entity_id=tag.id, entity_name=tag.name, before=_d(tag),
        ip_address=request.client.host if request.client else None)
    db.delete(tag); db.commit()
