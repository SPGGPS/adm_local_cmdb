import os, logging
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

logger = logging.getLogger("tfg.db")
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./tfg.db")
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args, echo=os.getenv("SQL_ECHO","false")=="true")
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback(); raise
    finally:
        db.close()

def _auto_migrate():
    """Añade columnas nuevas y arregla tipos incompatibles sin borrar datos."""
    from sqlalchemy import text, inspect
    inspector = inspect(engine)
    with engine.connect() as conn:
        # Fix especial: convertir assets.type de ENUM nativo a VARCHAR
        # para soportar nuevos tipos (vcenter, web_server, etc.) sin migración manual
        try:
            cols = {c["name"]: c for c in inspector.get_columns("assets")}
            if "type" in cols:
                type_info = str(cols["type"]["type"]).upper()
                if "VARCHAR" not in type_info and "CHARACTER" not in type_info:
                    conn.execute(text(
                        "ALTER TABLE assets ALTER COLUMN type TYPE VARCHAR(50) USING type::text"
                    ))
                    conn.commit()
                    logger.info("Auto-migrated: assets.type ENUM → VARCHAR(50)")
        except Exception as e:
            conn.rollback()
            logger.warning(f"Type migration skipped: {e}")

        # Mismo fix para data_sources.type: convertir ENUM → VARCHAR para soportar
        # nuevos tipos (apps, docker, k8s) sin ALTER TYPE ADD VALUE manual
        try:
            if inspector.has_table("data_sources"):
                ds_cols = {c["name"]: c for c in inspector.get_columns("data_sources")}
                if "type" in ds_cols:
                    type_info = str(ds_cols["type"]["type"]).upper()
                    if "VARCHAR" not in type_info and "CHARACTER" not in type_info:
                        conn.execute(text(
                            "ALTER TABLE data_sources ALTER COLUMN type TYPE VARCHAR(50) USING type::text"
                        ))
                        conn.commit()
                        logger.info("Auto-migrated: data_sources.type ENUM → VARCHAR(50)")
        except Exception as e:
            conn.rollback()
            logger.warning(f"data_sources type migration skipped: {e}")

        for table in Base.metadata.sorted_tables:
            if not inspector.has_table(table.name):
                continue  # tabla nueva → create_all la creará
            existing = {col["name"] for col in inspector.get_columns(table.name)}
            for col in table.columns:
                if col.name not in existing:
                    col_type_str = col.type.compile(dialect=engine.dialect)
                    try:
                        conn.execute(text(
                            f'ALTER TABLE "{table.name}" ADD COLUMN IF NOT EXISTS "{col.name}" {col_type_str}'
                        ))
                        conn.commit()
                        logger.info(f"Auto-migrated: {table.name}.{col.name} ({col_type_str})")
                    except Exception as e:
                        conn.rollback()
                        logger.warning(f"Migration skipped {table.name}.{col.name}: {e}")

def init_db():
    from app.models import Asset, AssetHistory, AssetChangeLog, Tag, AuditLog, DataSource, ComplianceException, UserProfile  
    Base.metadata.create_all(bind=engine)   # crea tablas nuevas
    _auto_migrate()                          # añade columnas nuevas a tablas existentes
    logger.info("DB tables ready")
