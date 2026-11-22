import io
import time
from contextlib import ExitStack

import pytest
from conftest import make_test_client
from PIL import Image
from sqlalchemy import func, select, text
from test_telegram_validation import signed_data

from poidem.db.base import Base
from poidem.db.models import AuthSession, MediaDeletion, Photo, User
from poidem.main import create_app

pytestmark = pytest.mark.database
ORIGIN = {"Origin": "http://127.0.0.1:5173"}


@pytest.fixture
def clients(api_settings, migration_engine):
    # Только изолированная *_test БД, проверенная conftest до подключения.
    tables = [
        name
        for name in Base.metadata.tables
        if name not in {"interests", "gender_options", "preference_options", "categories"}
    ]
    statement = text("TRUNCATE " + ",".join(f'"{name}"' for name in tables) + " CASCADE")
    with migration_engine.begin() as connection:
        connection.execute(statement)
    with ExitStack() as stack:

        def new():
            return stack.enter_context(make_test_client(create_app(api_settings)))

        yield new
    with migration_engine.begin() as connection:
        connection.execute(statement)


def login(client, identity=101):
    response = client.post(
        "/api/v1/auth/telegram",
        json={"init_data": signed_data(identity, int(time.time()))},
        headers=ORIGIN,
    )
    assert response.status_code == 200, response.text
    return response.json()


def headers(account):
    return {**ORIGIN, "X-CSRF-Token": account["csrf_token"]}


def image_bytes(format="PNG"):
    stream = io.BytesIO()
    image = Image.new("RGB", (64, 64), "red")
    if format == "JPEG":
        exif = Image.Exif()
        exif[270] = "private camera metadata"
        image.save(stream, format, exif=exif)
    else:
        image.save(stream, format)
    return stream.getvalue()


def upload(client, account, *, content=None, mime="image/png", filename="face.png"):
    return client.post(
        "/api/v1/me/photos",
        files={"file": (filename, image_bytes() if content is None else content, mime)},
        headers=headers(account),
    )


def profile(photo, **overrides):
    return {
        "expected_version": 0,
        "name": "Проверка",
        "age": 24,
        "gender_code": "woman",
        "preference_code": "any",
        "bio": "Проверка своего профиля",
        "photo_id": photo["id"],
        "interest_ids": ["art", "coffee", "walks"],
        **overrides,
    }


def test_login_cookie_is_httponly_and_account_is_reused(clients, migration_engine):
    client = clients()
    result = client.post(
        "/api/v1/auth/telegram",
        json={"init_data": signed_data(101, int(time.time()))},
        headers=ORIGIN,
    )
    assert result.status_code == 200
    assert "HttpOnly" in result.headers["set-cookie"]
    assert "SameSite=lax" in result.headers["set-cookie"]
    account = result.json()
    cookie = client.cookies.get("poidem_session")
    assert cookie and len(cookie) >= 40
    assert account["profile"] is None
    again = login(client)
    assert again["user"]["id"] == account["user"]["id"]
    assert client.cookies.get("poidem_session") != cookie
    assert client.get("/api/v1/me").json()["user"]["id"] == account["user"]["id"]
    with migration_engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(User)) == 1
        stored = connection.scalar(select(AuthSession.token_hash))
    assert stored != cookie
    assert "telegram_user_id" not in str(account)


def test_current_signed_context_replaces_a_cookie_of_another_account(clients):
    client = clients()
    first = login(client, 101)
    second = login(client, 202)
    assert second["user"]["id"] != first["user"]["id"]
    assert client.get("/api/v1/me").json()["user"]["id"] == second["user"]["id"]


def test_signed_login_is_rate_limited_in_postgresql(clients, api_settings):
    api_settings.login_requests_per_minute = 1
    client = clients()
    login(client)
    result = client.post(
        "/api/v1/auth/telegram",
        json={"init_data": signed_data(101, int(time.time()))},
        headers=ORIGIN,
    )
    assert result.status_code == 429
    assert result.headers["retry-after"] == "60"


def test_raw_init_data_and_token_are_not_in_application_logs(clients, caplog):
    import logging

    client = clients()
    raw = signed_data(101, int(time.time())) + "&user=invalid"
    with caplog.at_level(logging.INFO, logger="poidem"):
        assert (
            client.post(
                "/api/v1/auth/telegram", json={"init_data": raw}, headers=ORIGIN
            ).status_code
            == 401
        )
    assert raw not in caplog.text
    assert "unit-test-only-not-a-real-bot" not in caplog.text


def test_pixel_limit_and_fake_mime_are_rejected(clients, api_settings):
    api_settings.photo_max_pixels = 1024
    client = clients()
    account = login(client)
    assert upload(client, account).status_code == 422
    api_settings.photo_max_pixels = 16_000_000
    assert upload(client, account, mime="image/jpeg").status_code == 422


def test_pending_file_cleanup_survives_account_deletion(
    clients, api_settings, migration_engine, monkeypatch
):
    import asyncio
    from pathlib import Path

    from poidem.db.session import Database
    from poidem.services.media import drain_deletions

    client = clients()
    account = login(client)
    photo = upload(client, account).json()
    original = Path.unlink

    def unavailable(path, *args, **kwargs):
        if path.suffix == ".jpg" and path.parent == api_settings.media_root:
            raise OSError("synthetic storage failure")
        return original(path, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", unavailable)
    result = client.delete("/api/v1/me", headers=headers(account))
    assert result.status_code == 202
    assert result.json()["media_cleanup_pending"] is True
    assert client.get(photo["url"]).status_code == 401
    monkeypatch.setattr(Path, "unlink", original)
    with migration_engine.begin() as connection:
        connection.execute(
            text("UPDATE media_deletions SET next_attempt_at=now()-interval '1 minute'")
        )

    async def retry_after_restart():
        database = Database(api_settings)
        try:
            await drain_deletions(database, api_settings)
        finally:
            await database.close()

    asyncio.run(retry_after_restart(), loop_factory=asyncio.SelectorEventLoop)
    assert not list(api_settings.media_root.glob("*.jpg"))


def test_future_shared_plan_data_prevents_partial_account_deletion(clients, migration_engine):
    import uuid
    from datetime import UTC, datetime, timedelta

    from poidem.db.models import Category, Plan

    client = clients()
    account = login(client)
    photo = upload(client, account).json()
    code = f"test-{uuid.uuid4()}"
    with migration_engine.begin() as connection:
        connection.execute(
            Category.__table__.insert().values(code=code, title="Тест", cover_asset_key="test")
        )
        plan_id = connection.scalar(
            Plan.__table__.insert()
            .values(
                author_id=uuid.UUID(account["user"]["id"]),
                category_code=code,
                title="Будущий план",
                place="Тест",
                description="Тест",
                starts_at=datetime.now(UTC) + timedelta(days=1),
                time_zone="UTC",
            )
            .returning(Plan.id)
        )
    result = client.delete("/api/v1/me", headers=headers(account))
    assert result.status_code == 409
    assert result.json()["error"]["code"] == "ACCOUNT_HAS_RELATED_DATA"
    assert client.get("/api/v1/me").status_code == 200
    assert client.get(photo["url"]).status_code == 200
    with migration_engine.begin() as connection:
        connection.execute(Plan.__table__.delete().where(Plan.id == plan_id))
        connection.execute(Category.__table__.delete().where(Category.code == code))


def test_tampered_direct_id_and_missing_or_old_init_data_are_rejected(clients):
    client = clients()
    raw = signed_data(101, int(time.time()))
    assert (
        client.post(
            "/api/v1/auth/telegram",
            json={"init_data": raw, "telegram_user_id": 202},
            headers=ORIGIN,
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/v1/auth/telegram", json={"init_data": raw.replace("101", "202")}, headers=ORIGIN
        ).status_code
        == 401
    )
    response = client.post(
        "/api/v1/auth/telegram",
        json={"init_data": signed_data(101, int(time.time()) - 301)},
        headers=ORIGIN,
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "TELEGRAM_AUTH_EXPIRED"
    assert client.get("/api/v1/me").status_code == 401


def test_origin_csrf_and_unauthenticated_writes_are_protected(clients):
    client = clients()
    raw = signed_data(101, int(time.time()))
    assert client.post("/api/v1/auth/telegram", json={"init_data": raw}).status_code == 403
    assert client.put("/api/v1/me/profile", json={}).status_code == 401
    account = login(client)
    assert client.delete("/api/v1/me", headers=ORIGIN).status_code == 403
    assert (
        client.delete(
            "/api/v1/me", headers={**headers(account), "Origin": "https://attacker.example"}
        ).status_code
        == 403
    )
    assert client.get("/api/v1/me").status_code == 200
    assert client.post("/api/v1/auth/logout", headers=headers(account)).status_code == 204
    assert client.get("/api/v1/me").status_code == 401


@pytest.mark.parametrize(
    "format,mime", [("PNG", "image/png"), ("JPEG", "image/jpeg"), ("WEBP", "image/webp")]
)
def test_photo_is_decoded_sanitized_and_private(clients, api_settings, format, mime):
    client = clients()
    account = login(client)
    response = upload(
        client, account, content=image_bytes(format), mime=mime, filename="../../escape.svg"
    )
    assert response.status_code == 201, response.text
    photo = response.json()
    loaded = client.get(photo["url"])
    assert loaded.status_code == 200
    assert loaded.headers["content-type"] == "image/jpeg"
    with Image.open(io.BytesIO(loaded.content)) as image:
        assert not image.getexif()
    assert loaded.headers["cache-control"] == "no-store"
    assert len(list(api_settings.media_root.glob("*.jpg"))) == 1
    stranger = clients()
    login(stranger, 202)
    assert stranger.get(photo["url"]).status_code == 404


@pytest.mark.parametrize(
    "content,mime,expected",
    [
        (b"not an image", "image/jpeg", 422),
        (b"<svg/>", "image/svg+xml", 415),
        (b"x" * (3 * 1024 * 1024 + 1), "image/png", 413),
    ],
)
def test_bad_photos_are_rejected_without_saved_files(
    clients, api_settings, content, mime, expected
):
    client = clients()
    account = login(client)
    assert upload(client, account, content=content, mime=mime).status_code == expected
    assert not list(api_settings.media_root.glob("*.jpg"))


def test_registration_edit_reload_and_foreign_profile_are_protected(clients):
    client = clients()
    account = login(client)
    photo = upload(client, account).json()
    saved = client.put("/api/v1/me/profile", json=profile(photo), headers=headers(account))
    assert saved.status_code == 200, saved.text
    assert saved.json()["profile"]["version"] == 1
    restored = login(client)
    assert restored["profile"]["name"] == "Проверка"
    changed = client.put(
        "/api/v1/me/profile",
        json=profile(photo, expected_version=1, name="Новое имя"),
        headers=headers(restored),
    )
    assert changed.status_code == 200
    assert changed.json()["profile"]["version"] == 2
    assert (
        client.put(
            "/api/v1/me/profile", json=profile(photo, expected_version=1), headers=headers(restored)
        ).status_code
        == 409
    )
    other = clients()
    other_account = login(other, 202)
    assert other.get("/api/v1/me/profile").json()["profile"] is None
    assert (
        other.put(
            "/api/v1/me/profile", json=profile(photo), headers=headers(other_account)
        ).status_code
        == 404
    )
    assert (
        other.put(
            "/api/v1/me/profile",
            json=profile(photo, user_id=account["user"]["id"]),
            headers=headers(other_account),
        ).status_code
        == 422
    )
    assert (
        other.put(
            f"/api/v1/users/{account['user']['id']}/profile",
            json=profile(photo),
            headers=headers(other_account),
        ).status_code
        == 404
    )


@pytest.mark.parametrize("age", [17, -1, 18.5, "24", True])
def test_age_must_be_integer_and_adult(clients, age):
    client = clients()
    account = login(client)
    photo = upload(client, account).json()
    assert (
        client.put(
            "/api/v1/me/profile", json=profile(photo, age=age), headers=headers(account)
        ).status_code
        == 422
    )


def test_no_product_upper_age_limit_and_three_unique_interests(clients):
    client = clients()
    account = login(client)
    photo = upload(client, account).json()
    assert (
        client.put(
            "/api/v1/me/profile",
            json=profile(photo, interest_ids=["art"] * 3),
            headers=headers(account),
        ).status_code
        == 422
    )
    assert (
        client.put(
            "/api/v1/me/profile", json=profile(photo, age=2000), headers=headers(account)
        ).status_code
        == 200
    )


def test_replaced_photos_and_pending_uploads_are_removed(clients, api_settings):
    client = clients()
    account = login(client)
    first = upload(client, account).json()
    assert (
        client.put("/api/v1/me/profile", json=profile(first), headers=headers(account)).status_code
        == 200
    )
    second = upload(client, account).json()
    assert len(list(api_settings.media_root.glob("*.jpg"))) == 2
    assert (
        client.put(
            "/api/v1/me/profile", json=profile(second, expected_version=1), headers=headers(account)
        ).status_code
        == 200
    )
    assert client.get(first["url"]).status_code == 404
    assert len(list(api_settings.media_root.glob("*.jpg"))) == 1


def test_deletion_removes_account_photos_and_all_sessions_but_not_other_user(
    clients, migration_engine, api_settings
):
    client = clients()
    account = login(client)
    second_device = clients()
    login(second_device)
    other = clients()
    other_account = login(other, 202)
    photo = upload(client, account).json()
    assert (
        client.put("/api/v1/me/profile", json=profile(photo), headers=headers(account)).status_code
        == 200
    )
    result = client.delete("/api/v1/me", headers=headers(account))
    assert result.status_code == 200, result.text
    assert result.json() == {"deleted": True, "media_cleanup_pending": False}
    assert second_device.get("/api/v1/me").status_code == 401
    assert other.get("/api/v1/me").json()["user"]["id"] == other_account["user"]["id"]
    assert not list(api_settings.media_root.glob("*.jpg"))
    with migration_engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(User)) == 1
        assert connection.scalar(select(func.count()).select_from(Photo)) == 0
        assert connection.scalar(select(func.count()).select_from(MediaDeletion)) == 0
    assert login(client)["profile"] is None


def test_oversized_json_and_expired_session_are_rejected(clients, migration_engine):
    client = clients()
    assert (
        client.post(
            "/api/v1/auth/telegram", json={"init_data": "x" * 17000}, headers=ORIGIN
        ).status_code
        == 413
    )
    login(client)
    with migration_engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE auth_sessions SET authenticated_at=now()-interval '2 days', "
                "expires_at=now()-interval '1 day'"
            )
        )
    assert client.get("/api/v1/me").status_code == 401
