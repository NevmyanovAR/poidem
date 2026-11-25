"""Только локальная серверная команда назначения роли существующему пользователю."""

import argparse
import uuid

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from poidem.db.models import AdminAuditLog, User
from poidem.settings import load_settings


def assign_role(session, identity, role, reason):
    user = session.scalar(select(User).where(User.id == identity).with_for_update())
    if not user or user.account_status != "active":
        raise ValueError("Нужен существующий активный пользователь после Telegram-входа")
    if role not in ("user", "admin") or len(reason.strip()) < 3:
        raise ValueError("Нужны роль user/admin и причина")
    previous = user.role_code
    if previous == role:
        return False
    user.role_code = role
    user.version += 1
    session.add(
        AdminAuditLog(
            actor_id=user.id,
            action="server_assign_role",
            target_ref=f"user:{user.id}",
            old_status=previous,
            new_status=role,
            reason_code=reason.strip(),
            request_id=uuid.uuid4(),
        )
    )
    session.commit()
    return True


def main():
    parser = argparse.ArgumentParser(
        description="Назначение роли локальным оператором; HTTP-аналога нет"
    )
    parser.add_argument("--user-id", type=uuid.UUID, required=True)
    parser.add_argument("--role", choices=("user", "admin"), required=True)
    parser.add_argument("--reason", required=True)
    parser.add_argument("--confirm-user-id", type=uuid.UUID, required=True)
    args = parser.parse_args()
    if args.confirm_user_id != args.user_id:
        parser.error("Повторно укажи тот же подтверждённый UUID пользователя")
    settings = load_settings()
    if not settings.migration_database_url:
        parser.error("Нужен локальный MIGRATION_DATABASE_URL")
    engine = create_engine(settings.migration_database_url.get_secret_value(), hide_parameters=True)
    try:
        with Session(engine) as session:
            changed = assign_role(session, args.user_id, args.role, args.reason)
        print(
            "Роль изменена; действие локального оператора записано в аудит"
            if changed
            else "Роль уже установлена"
        )
    except ValueError as error:
        parser.exit(1, str(error) + "\n")
    except Exception:
        parser.exit(1, "Не удалось изменить роль; проверь локальную конфигурацию БД\n")
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
