"""Только локальная серверная команда назначения роли существующему пользователю."""

import argparse
import uuid

from sqlalchemy import create_engine, func, select, text
from sqlalchemy.orm import Session

from poidem.db.models import AdminAuditLog, User
from poidem.services.admin_permissions import ROLES, TEAM_LOCK
from poidem.settings import load_settings


def assign_role(session, identity, role, reason):
    session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": TEAM_LOCK})
    user = session.scalar(select(User).where(User.id == identity).with_for_update())
    if not user or user.account_status != "active":
        raise ValueError("Нужен существующий активный пользователь после Telegram-входа")
    if role not in ROLES or not 3 <= len(reason.strip()) <= 300:
        raise ValueError("Нужны допустимая роль и причина от 3 до 300 символов")
    previous = user.role_code
    if previous == role:
        return False
    if previous == "owner" and role != "owner":
        owners = session.scalar(
            select(func.count())
            .select_from(User)
            .where(User.role_code == "owner", User.account_status == "active")
        )
        if owners <= 1:
            raise ValueError("Нельзя лишить систему последнего владельца")
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
        description="Доверенный оператор: первый owner и восстановление доступа"
    )
    parser.add_argument("--user-id", type=uuid.UUID, required=True)
    parser.add_argument("--role", choices=ROLES, required=True)
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
