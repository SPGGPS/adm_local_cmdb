"""
db_utils.py — Utilidades para manejo robusto de operaciones de base de datos.
Proporciona un wrapper que:
- Hace rollback automático ante cualquier excepción
- Convierte IntegrityError en HTTPException 409
- Convierte excepciones genéricas en HTTPException 500 con log
"""
import logging
from functools import wraps
from contextlib import contextmanager
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError, OperationalError, DataError
from sqlalchemy.orm import Session

logger = logging.getLogger("tfg.db_utils")

@contextmanager
def db_op(db: Session, *, conflict_msg: str = "Registro duplicado"):
    """
    Context manager para operaciones DB. Uso:

        with db_op(db, conflict_msg="Ya existe esta zona"):
            obj = Model(...)
            db.add(obj)
            db.flush()
            db.commit()
    """
    try:
        yield
    except IntegrityError as e:
        db.rollback()
        detail = str(e.orig) if hasattr(e, 'orig') else str(e)
        logger.warning(f"IntegrityError: {detail}")
        raise HTTPException(409, conflict_msg)
    except DataError as e:
        db.rollback()
        detail = str(e.orig) if hasattr(e, 'orig') else str(e)
        logger.warning(f"DataError: {detail}")
        raise HTTPException(422, f"Datos inválidos: {detail[:200]}")
    except OperationalError as e:
        db.rollback()
        logger.error(f"OperationalError: {e}")
        raise HTTPException(503, "Base de datos temporalmente no disponible")
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        logger.exception(f"Unexpected DB error: {e}")
        raise HTTPException(500, f"Error interno: {type(e).__name__}: {str(e)[:200]}")
