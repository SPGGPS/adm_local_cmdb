import os, logging, time, threading
from typing import Optional, List
import httpx
from jose import jwt, JWTError, ExpiredSignatureError
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

logger = logging.getLogger("tfg.auth")

KEYCLOAK_URL       = os.getenv("KEYCLOAK_URL", "http://keycloak:8080")
KEYCLOAK_REALM     = os.getenv("KEYCLOAK_REALM", "tfg")
KEYCLOAK_CLIENT_ID = os.getenv("KEYCLOAK_CLIENT_ID", "tfg-app")
JWKS_URI           = f"{KEYCLOAK_URL}/realms/{KEYCLOAK_REALM}/protocol/openid-connect/certs"
KEYCLOAK_CA_CERT   = os.getenv("KEYCLOAK_CA_CERT") or True
SKIP_AUTH          = os.getenv("SKIP_AUTH", "false").lower() == "true"
API_KEY            = os.getenv("API_KEY", "")  # Static key for service accounts (DAGs, CI)

DEV_USER = {
    "sub": "dev-user",
    "preferred_username": "devuser",
    "email": "dev@tfg.local",
    "roles": ["admin"],
}

SVCACCT_USER = {
    "sub": "svc-inventory-api",
    "preferred_username": "svc-inventory-api",
    "email": "svc-inventory-api@sistemas.local",
    "roles": ["admin"],
}

security = HTTPBearer(auto_error=not SKIP_AUTH)

_jwks_lock  = threading.Lock()
_jwks_cache = {"data": {"keys": []}, "fetched_at": 0.0}
_JWKS_TTL   = 300  # refresh every 5 min so key rotations take effect

def _get_jwks() -> dict:
    with _jwks_lock:
        now = time.monotonic()
        if now - _jwks_cache["fetched_at"] < _JWKS_TTL:
            return _jwks_cache["data"]
        try:
            resp = httpx.get(JWKS_URI, timeout=5, verify=KEYCLOAK_CA_CERT)
            resp.raise_for_status()
            _jwks_cache["data"] = resp.json()
            _jwks_cache["fetched_at"] = now
            logger.debug("JWKS refreshed from Keycloak")
        except Exception as e:
            logger.error(f"Failed to fetch JWKS: {e}")
        return _jwks_cache["data"]

def _decode_token(token: str) -> dict:
    jwks = _get_jwks()
    try:
        payload = jwt.decode(token, jwks, algorithms=["RS256"], options={"verify_aud": False})
        expected_iss = f"{KEYCLOAK_URL}/realms/{KEYCLOAK_REALM}"
        if payload.get("iss") != expected_iss:
            raise HTTPException(status_code=401, detail="Invalid token issuer")
        return payload
    except ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except JWTError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")

def _extract_roles(payload: dict) -> List[str]:
    resource_access = payload.get("resource_access", {})
    client_roles = resource_access.get(KEYCLOAK_CLIENT_ID, {}).get("roles", [])
    realm_roles  = payload.get("realm_access", {}).get("roles", [])
    return list(set(client_roles + realm_roles))

def _upsert_login(request: Request, user_id: str, success: bool, username: str = None):
    """Record login attempt in UserProfile + AuditLog (best-effort, never raises)."""
    try:
        from app.database import SessionLocal
        from app.models.user_profile import UserProfile
        from app.models.audit import AuditLog, ActivityType
        from datetime import datetime, timezone
        db = SessionLocal()
        ip = request.client.host if request.client else None
        ua = request.headers.get("user-agent", "")[:255]
        now = datetime.now(timezone.utc)
        profile = db.get(UserProfile, user_id)
        if not profile:
            profile = UserProfile(user_id=user_id)
            db.add(profile)
        if success:
            profile.last_login_at  = now
            profile.last_login_ip  = ip
        else:
            profile.last_failed_login_at = now
            profile.last_failed_login_ip = ip
        # AuditLog entry
        log = AuditLog(
            timestamp=now,
            user_id=user_id,
            username=username,
            activity_type=ActivityType.LOGIN if success else ActivityType.LOGIN_FAIL,
            entity_type="user",
            entity_id=user_id,
            entity_name=username,
            changes={"success": success, "ip": ip},
            ip_address=ip,
            user_agent=ua,
        )
        db.add(log)
        db.commit()
        db.close()
    except Exception as e:
        logger.warning(f"Could not upsert login record: {e}")

def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> dict:
    if SKIP_AUTH:
        return DEV_USER
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if API_KEY and credentials.credentials == API_KEY:
        return SVCACCT_USER
    try:
        payload = _decode_token(credentials.credentials)
        roles   = _extract_roles(payload)
        user = {
            "sub": payload.get("sub"),
            "preferred_username": payload.get("preferred_username"),
            "email": payload.get("email"),
            "roles": roles,
            "token": credentials.credentials,
        }
        _upsert_login(request, user["sub"], success=True, username=user.get("preferred_username"))
        return user
    except HTTPException as e:
        # Try to extract sub from expired token to record failed attempt
        try:
            payload = jwt.decode(credentials.credentials, options={"verify_signature": False})
            sub = payload.get("sub")
            if sub:
                _upsert_login(request, sub, success=False)
        except Exception:
            pass
        raise

def require_roles(*required_roles: str):
    def _checker(user: dict = Depends(get_current_user)) -> dict:
        if not set(user.get("roles", [])).intersection(required_roles):
            raise HTTPException(status_code=403, detail=f"Required roles: {list(required_roles)}")
        return user
    return _checker

require_admin  = require_roles("admin")
require_editor = require_roles("admin", "editor")
require_viewer = require_roles("admin", "editor", "viewer")
