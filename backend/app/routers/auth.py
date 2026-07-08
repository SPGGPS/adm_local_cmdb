import io, os, uuid, logging
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from app.database import get_db
from app.middleware.auth import get_current_user, require_viewer
from app.models.user_profile import UserProfile

logger    = logging.getLogger("tfg.auth_router")
router    = APIRouter(prefix="/v1/auth", tags=["Auth"])
KEYCLOAK_URL    = os.getenv("KEYCLOAK_URL", "http://keycloak:8080")
KEYCLOAK_REALM  = os.getenv("KEYCLOAK_REALM", "tfg")
KEYCLOAK_CLIENT = os.getenv("KEYCLOAK_CLIENT_ID", "tfg-app")
AVATAR_DIR      = os.getenv("AVATAR_DIR", "/tmp/avatars")
MAX_SIZE        = 2 * 1024 * 1024
MAGIC           = {b"\xff\xd8\xff": "image/jpeg", b"\x89PNG": "image/png"}

os.makedirs(AVATAR_DIR, exist_ok=True)

def _check_magic(data: bytes):
    for magic, mime in MAGIC.items():
        if data[:len(magic)] == magic:
            return mime
    return None

def _get_profile(db: Session, user_id: str) -> UserProfile:
    p = db.get(UserProfile, user_id)
    if not p:
        p = UserProfile(user_id=user_id)
        db.add(p); db.commit(); db.refresh(p)
    return p

@router.get("/oidc/config")
def oidc_config():
    return {
        "authority":              f"{KEYCLOAK_URL}/realms/{KEYCLOAK_REALM}",
        "client_id":              KEYCLOAK_CLIENT,
        "redirect_uri":           os.getenv("FRONTEND_URL","http://localhost:5173") + "/callback",
        "post_logout_redirect_uri": os.getenv("FRONTEND_URL","http://localhost:5173"),
        "scope":                  "openid profile email roles",
        "response_type":          "code",
        "pkce":                   True,
    }

@router.get("/me")
def get_me(request: Request, db: Session = Depends(get_db), user: dict = Depends(require_viewer)):
    profile = _get_profile(db, user["sub"])
    avatar_url = f"/v1/auth/me/avatar" if profile.avatar_filename else None
    return {
        "sub":                   user.get("sub"),
        "username":              user.get("preferred_username"),
        "email":                 user.get("email"),
        "roles":                 user.get("roles", []),
        "avatar_url":            avatar_url,
        "last_login_at":         profile.last_login_at.isoformat() if profile.last_login_at else None,
        "last_login_ip":         profile.last_login_ip,
        "last_failed_login_at":  profile.last_failed_login_at.isoformat() if profile.last_failed_login_at else None,
        "last_failed_login_ip":  profile.last_failed_login_ip,
    }

@router.get("/me/avatar")
def get_avatar(db: Session = Depends(get_db), user: dict = Depends(require_viewer)):
    profile = _get_profile(db, user["sub"])
    if not profile.avatar_filename:
        raise HTTPException(404, "No avatar set")
    filepath = os.path.join(AVATAR_DIR, profile.avatar_filename)
    if not os.path.isfile(filepath):
        raise HTTPException(404, "Avatar file not found")
    return FileResponse(filepath)

@router.patch("/me/avatar")
async def upload_avatar(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: dict  = Depends(require_viewer),
):
    content = await file.read()
    if len(content) > MAX_SIZE:
        raise HTTPException(422, "File exceeds 2MB limit")
    mime = _check_magic(content)
    if not mime:
        raise HTTPException(422, "Invalid file type. Only JPEG and PNG allowed.")
    # Strip EXIF
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(content))
        clean = Image.new(img.mode, img.size)
        clean.putdata(list(img.getdata()))
        buf = io.BytesIO()
        clean.save(buf, format="JPEG" if mime == "image/jpeg" else "PNG")
        content = buf.getvalue()
    except ImportError:
        logger.warning("Pillow not available — EXIF stripping skipped")

    ext      = "jpg" if mime == "image/jpeg" else "png"
    filename = f"{uuid.uuid4()}.{ext}"
    filepath = os.path.join(AVATAR_DIR, filename)
    with open(filepath, "wb") as f:
        f.write(content)

    # Delete old avatar file
    profile = _get_profile(db, user["sub"])
    if profile.avatar_filename:
        old = os.path.join(AVATAR_DIR, profile.avatar_filename)
        if os.path.isfile(old):
            os.remove(old)

    profile.avatar_filename = filename
    db.commit()
    logger.info(f"Avatar updated for {user.get('preferred_username')}: {filename}")
    return {"avatar_url": "/v1/auth/me/avatar"}
