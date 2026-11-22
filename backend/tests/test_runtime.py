import asyncio

import uvicorn

from poidem import __main__
from poidem.settings import Settings


def test_command_uses_psycopg_compatible_uvicorn_loop(monkeypatch):
    observed = {}

    def run(app, **kwargs):
        # Проверяем именно loop, переданный реальной командой запуска Uvicorn.
        config = uvicorn.Config(app, **kwargs)
        loop = config.get_loop_factory()()
        try:
            assert isinstance(loop, asyncio.SelectorEventLoop)
        finally:
            loop.close()
        observed["port"] = config.port

    monkeypatch.setattr("sys.argv", ["poidem"])
    monkeypatch.setattr(
        __main__,
        "load_settings",
        lambda: Settings(
            _env_file=None,
            database_url="postgresql+psycopg://test:test@127.0.0.1/unused",
        ),
    )
    monkeypatch.setattr(uvicorn, "run", run)
    monkeypatch.setattr(__main__, "configure_logging", lambda level: None)
    __main__.main()
    assert observed["port"] == 8001
