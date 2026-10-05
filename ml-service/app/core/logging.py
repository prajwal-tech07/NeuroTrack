import logging
import sys

logger = logging.getLogger("neurotrack_ml")
logger.setLevel(logging.INFO)

handler = logging.StreamHandler(sys.stdout)
handler.setFormatter(
    logging.Formatter(
        "[%(asctime)s] [%(process)d] [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
)
if not logger.handlers:
    logger.addHandler(handler)
