"""Жалобы с ограниченным контекстом и персональные блокировки в прежних таблицах."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("reports", sa.Column("target_key", sa.Text(), nullable=True))
    op.add_column(
        "reports", sa.Column("target_type", sa.Text(), nullable=False, server_default="legacy")
    )
    op.add_column("reports", sa.Column("case_id", sa.Uuid(), nullable=True))
    op.add_column(
        "reports",
        sa.Column(
            "evidence", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
    )
    op.create_foreign_key(
        "fk_reports_case_id_moderation_cases",
        "reports",
        "moderation_cases",
        ["case_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_reports_case_id", "reports", ["case_id"])
    op.create_unique_constraint(
        "uq_reports_reporter_target", "reports", ["reporter_id", "target_key"]
    )
    op.add_column(
        "user_restrictions",
        sa.Column("kind", sa.Text(), nullable=False, server_default="administrative"),
    )
    op.create_check_constraint(
        "kind_valid", "user_restrictions", "kind IN ('administrative','personal')"
    )
    op.create_check_constraint(
        "personal_not_self", "user_restrictions", "kind <> 'personal' OR user_id <> imposed_by"
    )
    op.create_index(
        "uq_personal_block_active",
        "user_restrictions",
        ["imposed_by", "user_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'personal' AND lifted_at IS NULL"),
    )


def downgrade():
    op.drop_index("uq_personal_block_active", table_name="user_restrictions")
    op.drop_constraint("personal_not_self", "user_restrictions", type_="check")
    op.drop_constraint("kind_valid", "user_restrictions", type_="check")
    op.drop_column("user_restrictions", "kind")
    op.drop_constraint("uq_reports_reporter_target", "reports", type_="unique")
    op.drop_index("ix_reports_case_id", table_name="reports")
    op.drop_constraint("fk_reports_case_id_moderation_cases", "reports", type_="foreignkey")
    for name in ("evidence", "case_id", "target_type", "target_key"):
        op.drop_column("reports", name)
