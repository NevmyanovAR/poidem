"""Настройки существующей привязки и устойчивый запрос комментария опроса."""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "bot_bindings",
        sa.Column("notifications_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "survey_recipients", sa.Column("comment_prompt_message_id", sa.BigInteger(), nullable=True)
    )
    op.create_index(
        "ix_notification_jobs_lease",
        "notification_jobs",
        ["lease_until"],
        postgresql_where=sa.text("state = 'leased'"),
    )


def downgrade():
    op.drop_index("ix_notification_jobs_lease", table_name="notification_jobs")
    op.drop_column("survey_recipients", "comment_prompt_message_id")
    op.drop_column("bot_bindings", "notifications_enabled")
