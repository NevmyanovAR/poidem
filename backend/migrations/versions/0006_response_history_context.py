"""Минимальный неизменяемый контекст отклика для истории, без новых сущностей."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "plan_responses", sa.Column("history_context", JSONB(none_as_null=True), nullable=True)
    )
    capture_legacy_context(op.get_bind())


def capture_legacy_context(connection):
    # Согласовано пользователем: один поздний снимок с явной source=legacy.
    # Не восстанавливаем закрытые модерацией анкеты и не выдаём фото/контакты.
    return connection.execute(
        sa.text(
            "UPDATE plan_responses r SET history_context=jsonb_build_object("
            "'plan_title',p.title,'author_name',a.name,'responder_name',b.name,"
            "'responder_age',b.age,'captured_at',statement_timestamp(),'source','legacy') "
            "FROM plans p,profiles a,profiles b,users ua,users ub "
            "WHERE r.history_context IS NULL AND p.id=r.plan_id "
            "AND a.user_id=r.plan_author_id AND b.user_id=r.responder_id "
            "AND ua.id=a.user_id AND ub.id=b.user_id "
            "AND ua.account_status='active' AND ub.account_status='active' "
            "AND p.moderation_status IN ('not_submitted','approved') "
            "AND a.moderation_status IN ('not_submitted','approved') "
            "AND b.moderation_status IN ('not_submitted','approved')"
        )
    )


def downgrade():
    raise RuntimeError("Исторический контекст нельзя удалять без отдельного согласования")
