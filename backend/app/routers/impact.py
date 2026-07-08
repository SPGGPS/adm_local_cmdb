from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.middleware.auth import require_viewer
from app.models.application import AppInfraBinding, ServiceComponent

router = APIRouter()

@router.get("/v1/assets/{asset_id}/impact")
def asset_impact(asset_id: str, db: Session = Depends(get_db), user=Depends(require_viewer)):
    bindings = db.query(AppInfraBinding).filter_by(asset_id=asset_id).all()
    affected_apps = {}
    for b in bindings:
        if not b.application: continue
        app = b.application
        affected_apps[app.id] = {
            "id": app.id, "name": app.name, "status": str(app.status).split(".")[-1],
            "binding_tier": str(b.binding_tier).split(".")[-1] if b.binding_tier else None,
            "is_critical": b.is_critical,
            "is_spf": b.is_single_point_of_failure,
        }
    affected_services = {}
    for app_id in affected_apps:
        components = db.query(ServiceComponent).filter_by(application_id=app_id).all()
        for sc in components:
            if not sc.service: continue
            svc = sc.service
            affected_services[svc.id] = {
                "id": svc.id, "name": svc.name,
                "criticality": str(svc.criticality).split(".")[-1],
                "status": str(svc.status).split(".")[-1],
            }
    return {
        "asset_id": asset_id,
        "affected_applications": list(affected_apps.values()),
        "affected_services": list(affected_services.values()),
        "total_affected_apps": len(affected_apps),
        "total_affected_services": len(affected_services),
        "has_critical_impact": any(s["criticality"] == "critical" for s in affected_services.values()),
    }
