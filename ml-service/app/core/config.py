import os
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    APP_NAME: str = "NeuroTrack ML Engine"
    API_V1_STR: str = "/api/v1"
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    DEBUG: bool = False
    MODEL_DIR: str = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models")

    # Quality Gate Threshold
    MIN_QUALITY: float = 0.35

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
