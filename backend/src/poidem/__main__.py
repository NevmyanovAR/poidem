"""Windows-совместимый запуск: python -m poidem."""

import argparse

import uvicorn

from poidem.logging import configure_logging
from poidem.settings import load_settings


def main() -> None:
    parser = argparse.ArgumentParser(description="Локальный сервер Пойдём?")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8001)
    args = parser.parse_args()
    settings = load_settings()
    configure_logging(settings.log_level)
    uvicorn.run(
        "poidem.main:create_app",
        factory=True,
        host=args.host,
        port=args.port,
        loop="poidem.runtime:loop_factory",
        access_log=False,
        log_config=None,
        proxy_headers=False,
    )


if __name__ == "__main__":
    main()
