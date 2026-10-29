from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Parkinson MRI API"
    debug: bool = True

    database_url: str
    cors_origins: str = "http://localhost:5173"

    auth_required: bool = False
    secret_key: str = "change-me"
    access_token_expire_minutes: int = 60
    jwt_algorithm: str = "HS256"

    redis_url: str = ""

    login_rate_limit: int = 5
    predict_rate_limit: int = 30
    history_rate_limit: int = 60
    rate_window_seconds: int = 60

    max_upload_mb: int = 50
    model_version: str = "dummy-0.1"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()