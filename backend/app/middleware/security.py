import time, logging
from collections import defaultdict
from threading import Lock
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response, JSONResponse

logger = logging.getLogger("tfg.security")
RATE_LIMIT_WINDOW = 60
RATE_LIMIT_MAX    = 20
AUTH_PATHS        = {"/v1/auth/"}
_store: dict      = defaultdict(list)
_lock             = Lock()

# Rutas de documentación — CSP relajado para Swagger/ReDoc
DOCS_PATHS = {"/docs", "/redoc", "/v1/openapi.json", "/openapi.json"}

class SecureHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        response.headers["X-Content-Type-Options"]  = "nosniff"
        response.headers["X-Frame-Options"]         = "DENY"
        response.headers["X-XSS-Protection"]        = "1; mode=block"
        response.headers["Referrer-Policy"]         = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"]      = "geolocation=(), microphone=(), camera=()"

        # Swagger UI y ReDoc necesitan CDN y scripts inline
        if request.url.path in DOCS_PATHS:
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; "
                "script-src 'self' 'unsafe-inline' cdn.jsdelivr.net unpkg.com; "
                "style-src 'self' 'unsafe-inline' cdn.jsdelivr.net unpkg.com fonts.googleapis.com; "
                "font-src 'self' fonts.gstatic.com data:; "
                "img-src 'self' data: fastapi.tiangolo.com; "
                "frame-ancestors 'none'"
            )
        else:
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; script-src 'self'; "
                "style-src 'self' 'unsafe-inline'; frame-ancestors 'none'"
            )

        if request.url.scheme == "https":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        if request.url.path.startswith("/v1/"):
            response.headers["Cache-Control"] = "no-store"
        return response

class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if any(request.url.path.startswith(p) for p in AUTH_PATHS):
            ip = request.client.host if request.client else "unknown"
            now = time.time()
            with _lock:
                _store[ip] = [t for t in _store[ip] if now - t < RATE_LIMIT_WINDOW]
                _store[ip].append(now)
                count = len(_store[ip])
            if count > RATE_LIMIT_MAX:
                logger.warning(f"Rate limit exceeded: {ip}")
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Too many requests. Try again later."},
                    headers={"Retry-After": str(RATE_LIMIT_WINDOW)},
                )
        return await call_next(request)
