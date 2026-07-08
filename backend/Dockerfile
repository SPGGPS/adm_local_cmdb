FROM python:3.11-slim AS base
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev curl \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir --upgrade pip setuptools wheel

RUN pip install --no-cache-dir \
    fastapi>=0.111.0 \
    "uvicorn[standard]>=0.29.0" \
    sqlalchemy>=2.0.0 \
    asyncpg>=0.29.0 \
    psycopg2-binary>=2.9.9 \
    "python-jose[cryptography]>=3.3.0" \
    httpx>=0.27.0 \
    python-multipart>=0.0.9 \
    pillow>=10.3.0 \
    pydantic>=2.7.0 \
    python-dotenv>=1.0.0 \
    pytest>=8.0.0 \
    pytest-cov>=5.0.0 \
    "apscheduler>=3.10.0" \
    pytest-asyncio>=0.23.0 \
    requests>=2.31.0

COPY app/ app/
COPY tests/ tests/

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

RUN useradd -m -u 1001 tfg && chown -R tfg:tfg /app
USER tfg

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:8000/v1/healthz || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
