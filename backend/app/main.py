import logging, os  # v6
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import init_db
from app.middleware.security import SecureHeadersMiddleware, RateLimitMiddleware
from app.routers import assets, tags, audit, auth, data_sources, exceptions
from app.routers.assets import cmdb_router
from app.scheduler import scheduler, daily_eol_sync
from app.services.asset_change_log import register_listener as _register_changelog
from apscheduler.triggers.cron import CronTrigger
from app.routers.applications import router as applications_router
from app.routers.certificates import router as certificates_router
from app.routers.locations import router as locations_router
from app.routers.impact import router as impact_router
from app.routers.eol import router as eol_router
from app.routers.dashboard import router as dashboard_router

logging.basicConfig(level=os.getenv("LOG_LEVEL","INFO").upper(),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("tfg")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Inventario Centralizado de Infraestructura TI...")
    _register_changelog()
    init_db()

    # Cargar datos de ejemplo si la base de datos esta vacia
    from app.seed import seed_if_empty
    seed_if_empty()

    # Auto-sync EOL al arrancar: detectar productos del inventario y sincronizar con endoflife.date
    try:
        import asyncio
        from app.scheduler import daily_eol_sync as _eol_startup
        asyncio.ensure_future(_eol_startup())
        logger.info("EOL auto-sync triggered in background (startup)")
    except Exception as e:
        logger.warning(f"EOL startup sync skipped: {e}")

    # Scheduler: recálculo EOL diario a las 05:00 (Europe/Madrid)
    scheduler.add_job(
        daily_eol_sync,
        CronTrigger(hour=5, minute=0, timezone="Europe/Madrid"),
        id="daily_eol_sync",
        replace_existing=True,
        misfire_grace_time=3600,  # si el servidor estaba parado, ejecutar hasta 1h tarde
    )
    from app.scheduler import daily_audit_cleanup
    scheduler.add_job(
        daily_audit_cleanup,
        CronTrigger(hour=2, minute=0, timezone="Europe/Madrid"),
        id="daily_audit_cleanup",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    scheduler.start()
    logger.info("Scheduler started — daily EOL sync at 05:00 Europe/Madrid")
    logger.info("Ready.")
    yield
    scheduler.shutdown(wait=False)
    logger.info("Scheduler stopped.")
app = FastAPI(title="Inventario Centralizado de Infraestructura TI", version="1.0.0",
    openapi_url="/v1/openapi.json", docs_url="/docs", redoc_url="/redoc", lifespan=lifespan)

CORS = os.getenv("CORS_ORIGINS","http://localhost:5173,http://localhost:3000").split(",")
app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in CORS],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.add_middleware(SecureHeadersMiddleware)
app.add_middleware(RateLimitMiddleware)

app.include_router(auth.router)
app.include_router(assets.router)
app.include_router(cmdb_router)
app.include_router(tags.router)
app.include_router(audit.router)
app.include_router(data_sources.router)
app.include_router(exceptions.router)
app.include_router(applications_router)
app.include_router(certificates_router)
app.include_router(locations_router)
app.include_router(impact_router)
app.include_router(eol_router)
app.include_router(dashboard_router)

APP_VERSION = os.environ.get("APP_VERSION", "dev")

@app.get("/v1/healthz", tags=["Health"])
def healthz(): return {"status":"ok","app":"Inventario Centralizado","version":APP_VERSION}

@app.get("/v1/version", tags=["Health"])
def get_version(): return {"version": APP_VERSION}

@app.get("/", include_in_schema=False)
def root(): return {"message":"Inventario Centralizado de Infraestructura TI. Ver /docs"}


@app.get("/health", include_in_schema=False)
def health_alias():
    return {"status": "ok"}


# Endpoint de administración (solo desarrollo/test)
from fastapi import APIRouter
from app.database import SessionLocal
from app.models.asset import Asset as AssetModel

_admin_router = APIRouter(prefix="/v1/admin", tags=["admin"])

@_admin_router.post("/reseed")
def reseed_database():
    from app.seed import seed_database
    from app.models.eol import EolCycle, EolProduct
    from app.models.application import AppInfraBinding, ServiceComponent, Application, Service
    from app.models.location import Zone, Site, Cell
    db = SessionLocal()
    try:
        db.query(AppInfraBinding).delete()
        db.query(ServiceComponent).delete()
        db.query(Application).delete()
        db.query(Service).delete()
        db.query(AssetModel).delete()
        db.query(EolCycle).delete()
        db.query(EolProduct).delete()
        db.query(Cell).delete()
        db.query(Site).delete()
        db.query(Zone).delete()
        db.commit()
        result = seed_database(db)
        return {"ok": True, "message": "Reseed completado", "total": result["total"]}
    except Exception as e:
        db.rollback()
        logger.error(f"Error en reseed: {e}")
        raise
    finally:
        db.close()

app.include_router(_admin_router)
