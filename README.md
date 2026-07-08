# Sistema de Inventario Centralizado de Infraestructura TI

Aplicación web full-stack para la gestión centralizada del inventario de infraestructura TI
de una administración pública local. Incluye CMDB, gestión de ciclo de vida del software (EOL),
seguimiento de cumplimiento de seguridad, mapa de dependencias y log de auditoría.

## Stack tecnológico

| Capa | Tecnología | Versión |
|------|-----------|---------|
| Backend | FastAPI + Python | 0.111 / 3.11 |
| Base de datos | PostgreSQL | 16 |
| ORM | SQLAlchemy | 2.0 |
| Frontend | React + Vite + Tailwind CSS | 18 / 5 / 3 |
| Scheduler | APScheduler | 3.10 |
| Auth | Keycloak OIDC/PKCE | 23 |
| Contenedores | Docker + Docker Compose | latest |

## Arranque rápido

```bash
git clone <repositorio> inventario-ti
cd inventario-ti
cp .env.example .env          # ajustar variables si es necesario
docker compose up -d          # arranca postgres, backend y frontend
```

La aplicación estará disponible en http://localhost:5173

## Variables de entorno

| Variable | Valor por defecto | Descripción |
|----------|-------------------|-------------|
| `POSTGRES_DB` | `inventory` | Nombre de la base de datos |
| `POSTGRES_USER` | `inventory` | Usuario de PostgreSQL |
| `POSTGRES_PASSWORD` | `inventory` | Contraseña de PostgreSQL |
| `SKIP_AUTH` | `true` | Omitir autenticación en desarrollo |
| `KEYCLOAK_URL` | `http://keycloak:8080` | URL del servidor Keycloak |
| `KEYCLOAK_REALM` | `inventory` | Realm de Keycloak |
| `KEYCLOAK_CLIENT_ID` | `tfg-app` | Client ID de Keycloak |

## Estructura del proyecto

```
inventory/
├── backend/
│   ├── app/
│   │   ├── models/          # Modelos SQLAlchemy
│   │   ├── routers/         # Endpoints FastAPI (11 routers)
│   │   ├── services/        # Lógica de negocio
│   │   ├── jobs/            # Jobs programados (EOL sync, purgas)
│   │   └── middleware/      # Autenticación JWT
│   └── tests/               # Suite de pruebas de integración
├── frontend/
│   ├── src/
│   │   ├── pages/           # 19 páginas React
│   │   ├── components/      # Componentes reutilizables
│   │   ├── services/        # Llamadas a la API
│   │   └── context/         # Contextos React (auth, etc.)
│   └── public/              # Assets estáticos
└── docker-compose.yml       # Orquestación de contenedores
```

## Ejecución de los tests

docker compose exec backend bash
pytest tests/test_api.py -v

## Licencia

Proyecto académico — Trabajo de Fin de Grado, Ingeniería Informática.
