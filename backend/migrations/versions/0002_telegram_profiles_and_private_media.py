"""telegram_profiles_and_private_media

Revision ID: 0002
Revises: 0001
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Явно проверенные DDL и неперсональные справочники прежней формы.
    op.create_table(
        "media_deletions",
        sa.Column("storage_key", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "next_attempt_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("storage_key", name=op.f("pk_media_deletions")),
    )
    op.create_index(
        op.f("ix_media_deletions_next_attempt_at"),
        "media_deletions",
        ["next_attempt_at"],
        unique=False,
    )
    op.create_table(
        "rate_limit_windows",
        sa.Column("key_hash", sa.Text(), nullable=False),
        sa.Column("window", sa.BigInteger(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.CheckConstraint("attempts > 0", name=op.f("ck_rate_limit_windows_attempts_positive")),
        sa.PrimaryKeyConstraint("key_hash", name=op.f("pk_rate_limit_windows")),
    )
    op.create_index(
        op.f("ix_rate_limit_windows_window"), "rate_limit_windows", ["window"], unique=False
    )
    op.alter_column(
        "profiles",
        "age",
        existing_type=sa.INTEGER(),
        type_=sa.BigInteger(),
        existing_nullable=False,
    )
    # Общие справочники утверждённой формы, без вымышленных пользователей/планов.
    for table, rows in (
        ("gender_options", [("woman", "Женский"), ("man", "Мужской"), ("other", "Другой")]),
        ("preference_options", [("women", "Девушек"), ("men", "Парней"), ("any", "Всех")]),
        (
            "interests",
            [
                ("art", "Искусство"),
                ("concerts", "Концерты"),
                ("coffee", "Кофе"),
                ("bars", "Бары"),
                ("walks", "Прогулки"),
                ("cinema", "Кино"),
                ("food", "Еда"),
                ("sport", "Спорт"),
            ],
        ),
    ):
        for code, title in rows:
            op.execute(
                sa.text(
                    f"INSERT INTO {table} (code,title,enabled) VALUES (:code,:title,true) "
                    "ON CONFLICT (code) DO NOTHING"
                ).bindparams(code=code, title=title)
            )


def downgrade() -> None:
    # Справочники сохраняются: на них могли появиться ссылки существующих анкет.
    # Сужение BIGINT до INTEGER нельзя применять к рабочим данным без проверки.
    op.alter_column(
        "profiles",
        "age",
        existing_type=sa.BigInteger(),
        type_=sa.INTEGER(),
        existing_nullable=False,
    )
    op.drop_index(op.f("ix_rate_limit_windows_window"), table_name="rate_limit_windows")
    op.drop_table("rate_limit_windows")
    op.drop_index(op.f("ix_media_deletions_next_attempt_at"), table_name="media_deletions")
    op.drop_table("media_deletions")
