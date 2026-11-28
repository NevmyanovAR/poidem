import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select, update
from test_accounts import clients as clients
from test_accounts import headers, image_bytes, login, profile, upload
from test_plans import create, publish
from test_plans import members as members

from poidem.db.models import AdminAuditLog, NotificationJob, PhotoVerification, User
from poidem.notification_worker import payload
from poidem.services import media
from poidem.services import photo_verification as service

pytestmark = pytest.mark.database


@pytest.fixture
def ready(members):
    (a, _), _ = members
    settings = a.app.state.settings
    settings.photo_verification_enabled = True
    settings.photo_verification_policy_approved = True
    settings.photo_verification_consent_version = "test-only-v1"
    settings.photo_verification_consent_text = (
        "Синтетический снимок: ручная проверка, 24 часа ожидания, 1 час после решения"
    )
    settings.photo_verification_pending_hours = 24
    settings.photo_verification_reviewed_retention_hours = 1
    return members


def start(client, account, **extra):
    return client.post(
        "/api/v1/me/photo-verification/challenge",
        json={"consent_version": "test-only-v1", "consent_accepted": True, **extra},
        headers=headers(account),
    )


def submit(client, account, request, **extra):
    return client.post(
        f"/api/v1/me/photo-verification/{request['id']}/selfie",
        files={"file": ("selfie.png", image_bytes(), "image/png")},
        headers=headers(account),
        **extra,
    )


def role(engine, account, value="moderator"):
    with engine.begin() as connection:
        connection.execute(
            update(User).where(User.id == uuid.UUID(account["user"]["id"])).values(role_code=value)
        )


def decide(client, account, entry, decision="approved", **extra):
    return client.post(
        f"/api/v1/admin/photo-verifications/{entry['id']}/decision",
        json={"expected_version": entry["version"], "decision": decision, **extra},
        headers=headers(account),
    )


def sent(ready):
    (a, aa), _ = ready
    challenge = start(a, aa)
    assert challenge.status_code == 200, challenge.text
    result = submit(a, aa, challenge.json())
    assert result.status_code == 200, result.text
    return result.json()


@pytest.mark.parametrize(
    "setting,value",
    [
        ("photo_verification_enabled", False),
        ("photo_verification_policy_approved", False),
        ("photo_verification_consent_text", ""),
        ("photo_verification_consent_version", ""),
        ("photo_verification_pending_hours", None),
        ("photo_verification_reviewed_retention_hours", None),
    ],
)
def test_collection_disabled_until_complete_approved_policy(
    ready, migration_engine, setting, value
):
    (a, aa), _ = ready
    setattr(a.app.state.settings, setting, value)
    assert a.get("/api/v1/me/photo-verification").json()["available"] is False
    assert start(a, aa).status_code == 503
    with migration_engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(PhotoVerification)) == 0


def test_real_lifecycle_badge_private_images_audit_and_profile_edit(ready, migration_engine):
    (a, aa), (b, ba) = ready
    entry = sent(ready)
    assert a.get("/api/v1/me/photo-verification").json()["state"] == "pending"
    assert a.get("/api/v1/me/profile").json()["profile"]["photo_verified"] is False
    assert a.get(f"/api/v1/me/photo-verification/{entry['id']}/selfie").status_code == 200
    assert b.get(f"/api/v1/me/photo-verification/{entry['id']}/selfie").status_code == 404
    assert b.get("/api/v1/admin/photo-verifications").status_code == 403
    role(migration_engine, ba, "analyst")
    assert b.get(f"/api/v1/admin/photo-verifications/{entry['id']}/photo/selfie").status_code == 403
    role(migration_engine, ba)
    queue = b.get("/api/v1/admin/photo-verifications").json()
    assert len(queue["items"]) == 1
    detail = b.get(f"/api/v1/admin/photo-verifications/{entry['id']}").json()
    assert detail["can_decide"]
    assert (
        b.get(detail["primary_url"]).status_code == b.get(detail["selfie_url"]).status_code == 200
    )
    approved = decide(b, ba, entry)
    assert approved.status_code == 200, approved.text
    assert decide(b, ba, entry).status_code == 409
    assert a.get("/api/v1/me/photo-verification").json()["photo_verified"] is True
    account_profile = a.get("/api/v1/me/profile").json()["profile"]
    changed = profile(
        account_profile["photo"], expected_version=account_profile["version"], bio="Другое описание"
    )
    assert (
        a.put("/api/v1/me/profile", json=changed, headers=headers(aa)).json()["profile"][
            "photo_verified"
        ]
        is True
    )
    plan = publish(a, aa, create(a, aa).json()["plan"]).json()["plan"]
    public = b.get(f"/api/v1/plans/{plan['id']}/author").json()["profile"]
    assert public["photo_verified"] is True
    assert "selfie" not in str(public) and "consent" not in str(public)
    with migration_engine.connect() as connection:
        assert (
            connection.scalar(
                select(func.count())
                .select_from(NotificationJob)
                .where(NotificationJob.kind == "photo_verification_approved")
            )
            == 1
        )
        assert (
            connection.scalar(
                select(func.count())
                .select_from(AdminAuditLog)
                .where(AdminAuditLog.action == "photo_verification.approved")
            )
            == 1
        )


def test_photo_replacement_invalidates_approved_and_pending_but_upload_alone_does_not(
    ready, migration_engine, clients
):
    (a, aa), (b, ba) = ready
    entry = sent(ready)
    role(migration_engine, ba)
    assert decide(b, ba, entry).status_code == 200
    old = a.get("/api/v1/me/profile").json()["profile"]
    new_photo = upload(a, aa).json()
    assert a.get("/api/v1/me/profile").json()["profile"]["photo_verified"] is True
    result = a.put(
        "/api/v1/me/profile",
        json=profile(new_photo, expected_version=old["version"]),
        headers=headers(aa),
    )
    assert result.status_code == 200, result.text
    assert result.json()["profile"]["photo_verified"] is False
    assert a.get("/api/v1/me/photo-verification").json()["state"] == "invalidated"
    assert decide(b, ba, entry).status_code == 409
    assert b.get(f"/api/v1/admin/photo-verifications/{entry['id']}/photo/selfie").status_code == 404
    new = start(a, aa)
    assert new.status_code == 200
    pending = submit(a, aa, new.json()).json()
    photo2 = upload(a, aa).json()
    version = result.json()["profile"]["version"]
    assert (
        a.put(
            "/api/v1/me/profile",
            json=profile(photo2, expected_version=version),
            headers=headers(aa),
        ).status_code
        == 200
    )
    assert decide(b, ba, pending).status_code == 409


def test_concurrent_challenges_submissions_and_two_moderator_decisions_are_atomic(
    ready, migration_engine, clients
):
    (a, aa), (b, ba) = ready
    with ThreadPoolExecutor(max_workers=4) as pool:
        starts = list(pool.map(lambda _: start(a, aa), range(4)))
    assert all(item.status_code == 200 for item in starts)
    assert len({item.json()["id"] for item in starts}) == 1
    with ThreadPoolExecutor(max_workers=4) as pool:
        uploads = list(pool.map(lambda _: submit(a, aa, starts[0].json()), range(4)))
    assert all(item.status_code == 200 for item in uploads), [item.text for item in uploads]
    assert len({item.json()["id"] for item in uploads}) == 1
    role(migration_engine, ba)
    c = clients()
    ca = login(c, 303)
    role(migration_engine, ca)
    entry = uploads[0].json()
    with ThreadPoolExecutor(max_workers=2) as pool:
        replies = list(
            pool.map(
                lambda action: decide(
                    b if action == "approved" else c,
                    ba if action == "approved" else ca,
                    entry,
                    action,
                    **({"reason_code": "face_unclear"} if action == "rejected" else {}),
                ),
                ("approved", "rejected"),
            )
        )
    assert sorted(item.status_code for item in replies) == [200, 409]
    with migration_engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(PhotoVerification)) == 1
        assert connection.scalar(select(func.count()).select_from(NotificationJob)) == 1


def test_rejection_reason_retry_and_consent_cannot_be_spoofed(ready, migration_engine):
    (a, aa), (b, ba) = ready
    for changes in (
        {"consent_accepted": False},
        {"consent_accepted": 1},
        {"user_id": ba["user"]["id"]},
        {"photo_revision": 1},
        {"state": "approved"},
    ):
        assert start(a, aa, **changes).status_code == 422
    assert start(a, aa, consent_version="old").status_code == 409
    entry = sent(ready)
    role(migration_engine, ba)
    assert decide(b, ba, entry, "rejected").status_code == 422
    assert decide(b, ba, entry, "rejected", reason_code="other", comment="").status_code == 422
    result = decide(b, ba, entry, "rejected", reason_code="face_unclear")
    assert result.status_code == 200, result.text
    status = a.get("/api/v1/me/photo-verification").json()
    assert status["state"] == "rejected" and status["request"]["reason"] == "Лицо плохо видно"
    retry = start(a, aa)
    assert retry.status_code == 200 and retry.json()["id"] != entry["id"]


def test_expiration_revocation_and_retention_remove_images_not_badge(ready, migration_engine):
    (a, aa), (b, ba) = ready
    entry = sent(ready)
    role(migration_engine, ba)
    assert decide(b, ba, entry).status_code == 200
    with migration_engine.begin() as connection:
        keys = connection.execute(
            select(PhotoVerification.primary_key, PhotoVerification.selfie_key)
        ).one()
        connection.execute(
            update(PhotoVerification).values(purge_at=datetime.now(UTC) - timedelta(seconds=1))
        )
    a.portal.call(clean, a.app.state.database, a.app.state.settings)
    assert a.get("/api/v1/me/photo-verification").json()["photo_verified"] is True
    assert all(not media.media_path(a.app.state.settings, key).exists() for key in keys)
    current = a.get("/api/v1/me/photo-verification").json()["request"]
    revoke = a.post(
        f"/api/v1/me/photo-verification/{current['id']}/withdraw",
        json={"expected_version": current["version"]},
        headers=headers(aa),
    )
    assert revoke.status_code == 200
    assert a.get("/api/v1/me/profile").json()["profile"]["photo_verified"] is False
    retry = start(a, aa).json()
    with migration_engine.begin() as connection:
        connection.execute(
            update(PhotoVerification)
            .where(PhotoVerification.id == uuid.UUID(retry["id"]))
            .values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
        )
    assert submit(a, aa, retry).status_code == 409
    assert start(a, aa).status_code == 200


async def clean(database, settings):
    async with database.sessions() as session:
        await service.cleanup(session)
        await session.commit()
    await media.drain_deletions(database, settings)


def test_unknown_owner_bad_mime_unauthorized_csrf_and_self_review(ready, migration_engine):
    (a, aa), (b, ba) = ready
    entry = start(a, aa).json()
    assert submit(b, ba, entry).status_code == 404
    assert (
        a.post(
            f"/api/v1/me/photo-verification/{entry['id']}/selfie",
            files={"file": ("bad.png", b"not-image", "image/png")},
            headers=headers(aa),
        ).status_code
        == 422
    )
    assert (
        a.post(
            "/api/v1/me/photo-verification/challenge",
            json={"consent_accepted": True, "consent_version": "test-only-v1"},
        ).status_code
        == 403
    )
    sent_entry = submit(a, aa, entry).json()
    role(migration_engine, aa)
    assert decide(a, aa, sent_entry).status_code == 403
    b.cookies.clear()
    assert b.get("/api/v1/me/photo-verification").status_code == 401


def test_account_deletion_clears_verification_materials(ready, migration_engine):
    (a, aa), (b, ba) = ready
    entry = sent(ready)
    role(migration_engine, ba)
    assert decide(b, ba, entry).status_code == 200
    with migration_engine.connect() as connection:
        keys = connection.execute(
            select(PhotoVerification.primary_key, PhotoVerification.selfie_key)
        ).one()
    deleted = a.delete("/api/v1/me", headers=headers(aa))
    assert deleted.status_code == 200, deleted.text
    assert all(not media.media_path(a.app.state.settings, key).exists() for key in keys)
    with migration_engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(PhotoVerification)) == 0


async def notification_payload(database, settings, identity):
    async with database.sessions() as session:
        entry = await session.get(NotificationJob, identity)
        return await payload(session, entry, None, settings)


@pytest.mark.parametrize(
    "decision,extra",
    [("approved", {}), ("rejected", {"reason_code": "other", "comment": "Пересними <b>кадр</b>"})],
)
def test_notification_uses_existing_outbox_safe_html_deep_link_and_obsolete_suppression(
    ready, migration_engine, decision, extra
):
    (a, aa), (b, ba) = ready
    a.app.state.settings.mini_app_url = "https://example.invalid/"
    entry = sent(ready)
    role(migration_engine, ba)
    assert decide(b, ba, entry, decision, **extra).status_code == 200
    with migration_engine.connect() as connection:
        identity = connection.scalar(select(NotificationJob.id))
    message, buttons = a.portal.call(
        notification_payload, a.app.state.database, a.app.state.settings, identity
    )
    assert "<b>кадр</b>" not in message
    assert buttons.inline_keyboard[0][0].web_app.url.endswith("/settings/photo-verification")
    current = a.get("/api/v1/me/photo-verification").json()["request"]
    assert (
        a.post(
            f"/api/v1/me/photo-verification/{entry['id']}/withdraw",
            json={"expected_version": current["version"]},
            headers=headers(aa),
        ).status_code
        == 200
    )
    assert (
        a.portal.call(notification_payload, a.app.state.database, a.app.state.settings, identity)
        is None
    )


def test_daily_attempt_budget_and_expired_requests(ready, migration_engine):
    (a, aa), _ = ready
    a.app.state.settings.photo_verification_attempts_per_day = 2
    for _ in range(2):
        entry = start(a, aa).json()
        with migration_engine.begin() as connection:
            connection.execute(
                update(PhotoVerification)
                .where(PhotoVerification.id == uuid.UUID(entry["id"]))
                .values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
            )
    assert start(a, aa).status_code == 429


def test_photo_change_racing_with_approval_can_never_verify_replacement(ready, migration_engine):
    (a, aa), (b, ba) = ready
    entry = sent(ready)
    role(migration_engine, ba)
    own = a.get("/api/v1/me/profile").json()["profile"]
    replacement = upload(a, aa).json()
    with ThreadPoolExecutor(max_workers=2) as pool:
        approval = pool.submit(lambda: decide(b, ba, entry))
        changing = pool.submit(
            lambda: a.put(
                "/api/v1/me/profile",
                json=profile(replacement, expected_version=own["version"]),
                headers=headers(aa),
            )
        )
        assert approval.result().status_code in (200, 409)
        assert changing.result().status_code == 200
    assert a.get("/api/v1/me/profile").json()["profile"]["photo_verified"] is False
    assert a.get("/api/v1/me/photo-verification").json()["state"] == "invalidated"


def test_role_revoked_after_viewing_cannot_decide(ready, migration_engine):
    (a, aa), (b, ba) = ready
    entry = sent(ready)
    role(migration_engine, ba)
    assert b.get(f"/api/v1/admin/photo-verifications/{entry['id']}").status_code == 200
    role(migration_engine, ba, "analyst")
    assert decide(b, ba, entry).status_code == 403


def test_changed_consent_replaces_unsubmitted_challenge_only_after_new_agreement(ready):
    (a, aa), _ = ready
    first = start(a, aa).json()
    a.app.state.settings.photo_verification_consent_version = "test-only-v2"
    assert start(a, aa).status_code == 409
    second = start(a, aa, consent_version="test-only-v2")
    assert second.status_code == 200, second.text
    assert second.json()["id"] != first["id"]
    assert submit(a, aa, first).status_code == 409
    assert submit(a, aa, second.json()).status_code == 200


def test_camera_sized_multipart_uses_photo_limit_and_normalizes_content(ready):
    import io
    import random

    from PIL import Image

    (a, aa), _ = ready
    entry = start(a, aa).json()
    output = io.BytesIO()
    Image.frombytes("RGB", (256, 256), random.Random(11).randbytes(256 * 256 * 3)).save(
        output, "PNG"
    )
    content = output.getvalue()
    assert 16384 < len(content) < a.app.state.settings.photo_max_bytes
    response = a.post(
        f"/api/v1/me/photo-verification/{entry['id']}/selfie",
        files={"file": ("frame.png", content, "image/png")},
        headers=headers(aa),
    )
    assert response.status_code == 200, response.text
    stored = a.get(f"/api/v1/me/photo-verification/{entry['id']}/selfie")
    with Image.open(io.BytesIO(stored.content)) as image:
        assert image.format == "JPEG" and not image.getexif()


def test_restricted_user_can_still_withdraw_consent_and_remove_materials(ready, migration_engine):
    (a, aa), _ = ready
    entry = sent(ready)
    with migration_engine.begin() as connection:
        connection.execute(
            update(User)
            .where(User.id == uuid.UUID(aa["user"]["id"]))
            .values(account_status="blocked")
        )
    state = a.get("/api/v1/me/photo-verification").json()
    assert state["available"] is False
    response = a.post(
        f"/api/v1/me/photo-verification/{entry['id']}/withdraw",
        json={"expected_version": entry["version"]},
        headers=headers(aa),
    )
    assert response.status_code == 200, response.text
    assert response.json()["state"] == "cancelled"


def test_configured_retention_backup_exclusion_and_immediate_purge(ready, migration_engine):
    from test_backup_local import module

    from poidem.db.models import Photo, Profile

    (a, aa), (b, ba) = ready
    settings = a.app.state.settings
    settings.photo_verification_pending_hours = 72
    settings.photo_verification_reviewed_retention_hours = 0
    state = a.get("/api/v1/me/photo-verification").json()
    assert state["retention"] == {"pending_hours": 72, "reviewed_hours": 0}
    entry = sent(ready)
    role(migration_engine, ba)
    with migration_engine.begin() as connection:
        connection.execute(
            update(PhotoVerification)
            .where(PhotoVerification.id == uuid.UUID(entry["id"]))
            .values(submitted_at=datetime.now(UTC) - timedelta(minutes=7))
        )
        keys = connection.execute(
            select(PhotoVerification.primary_key, PhotoVerification.selfie_key).where(
                PhotoVerification.id == uuid.UUID(entry["id"])
            )
        ).one()
        primary = connection.scalar(
            select(Photo.storage_key)
            .join(Profile, Profile.photo_id == Photo.id)
            .where(Profile.user_id == uuid.UUID(aa["user"]["id"]))
        )
    allowed = module().backup_media_keys(settings)
    assert primary in allowed and not set(keys).intersection(allowed)
    queue = b.get("/api/v1/admin/photo-verifications").json()
    assert queue["items"][0]["waiting_minutes"] >= 7
    response = decide(b, ba, entry)
    assert response.status_code == 200, response.text
    assert a.get("/api/v1/me/profile").json()["profile"]["photo_verified"] is True
    assert b.get(f"/api/v1/admin/photo-verifications/{entry['id']}/photo/selfie").status_code == 404
    assert a.get(f"/api/v1/me/photo-verification/{entry['id']}/selfie").status_code == 404
    with migration_engine.connect() as connection:
        assert connection.execute(
            select(PhotoVerification.primary_key, PhotoVerification.selfie_key).where(
                PhotoVerification.id == uuid.UUID(entry["id"])
            )
        ).one() == (None, None)
