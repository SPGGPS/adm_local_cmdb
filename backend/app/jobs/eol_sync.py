"""K8s CronJob: sincroniza productos EOL con endoflife.date y recalcula etiquetas."""
import asyncio, logging

logging.basicConfig(level="INFO", format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("job.eol_sync")

if __name__ == "__main__":
    from app.database import init_db
    from app.scheduler import daily_eol_sync
    init_db()
    asyncio.run(daily_eol_sync())
    logger.info("eol_sync: completed")
