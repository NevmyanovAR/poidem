"""Собственный каталог. Старые place_selections/venue и миграции не изменяются."""

import sqlalchemy as sa
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "public_places",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        *[
            sa.Column(name, sa.Text(), nullable=False)
            for name in ("name", "address", "city", "category", "dedupe_key", "search_text")
        ],
        sa.Column("status", sa.Text(), nullable=False, server_default="pending"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("proposer_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("reviewed_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("reason", sa.Text()),
        sa.UniqueConstraint("dedupe_key", name="uq_public_places_identity"),
        sa.CheckConstraint(
            "status IN ('pending','approved','rejected','hidden')", name="status_valid"
        ),
        sa.CheckConstraint("version > 0", name="version_positive"),
        sa.CheckConstraint(
            "length(btrim(name)) > 0 AND length(btrim(address)) > 0 AND length(btrim(city)) > 0",
            name="fields_nonempty",
        ),
        sa.CheckConstraint(
            "category IN ('cafe','restaurant','bar','museum','gallery',"
            "'cinema','theatre','park','culture')",
            name="category_valid",
        ),
        sa.CheckConstraint(
            "status <> 'approved' OR reviewed_at IS NOT NULL", name="approval_reviewed"
        ),
    )
    op.create_index(
        "ix_public_places_status_created", "public_places", ["status", "created_at", "id"]
    )
    op.create_index(
        "ix_public_places_proposer_created", "public_places", ["proposer_id", "created_at"]
    )
    op.alter_column("plans", "place_policy_version", server_default="local-catalog-v1")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON public_places TO poidem_app")


def downgrade():
    raise RuntimeError("Нельзя молча удалить каталог и историю ручных решений")
