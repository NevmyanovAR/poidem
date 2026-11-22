import asyncio


def loop_factory() -> asyncio.AbstractEventLoop:
    """Uvicorn >=0.36 сам выбирает loop, игнорируя Windows event-loop policy.

    Psycopg async требует SelectorEventLoop; явная фабрика работает в Windows
    и Linux. Subprocess/reload на этом этапе не используются.
    """
    return asyncio.SelectorEventLoop()
