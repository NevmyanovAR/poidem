"""11Б: добровольная ручная проверка конкретной версии фотографии."""

import sqlalchemy as sa
from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "profiles", sa.Column("photo_revision", sa.Integer(), nullable=False, server_default="1")
    )
    op.create_table(
        "photo_verifications",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("photo_id", sa.Uuid(), nullable=False),
        sa.Column("photo_revision", sa.Integer(), nullable=False),
        sa.Column("photo_content_version", sa.Integer(), nullable=False),
        sa.Column("gesture_code", sa.Text(), nullable=False),
        sa.Column("state", sa.Text(), nullable=False, server_default="pending"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("consent_version", sa.Text(), nullable=False),
        sa.Column("consent_text", sa.Text(), nullable=False),
        sa.Column("consented_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consent_revoked_at", sa.DateTime(timezone=True)),
        sa.Column("submitted_at", sa.DateTime(timezone=True)),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)),
        sa.Column("reviewed_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("reason_code", sa.Text()),
        sa.Column("reason_comment", sa.Text()),
        sa.Column("primary_key", sa.Text()),
        sa.Column("selfie_key", sa.Text()),
        sa.Column("purge_at", sa.DateTime(timezone=True)),
        sa.Column("review_retention_hours", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "state IN ('pending','approved','rejected','cancelled','expired')", name="state_valid"
        ),
        sa.CheckConstraint(
            "photo_revision > 0 AND photo_content_version > 0 AND version > 0",
            name="versions_positive",
        ),
        sa.CheckConstraint("review_retention_hours >= 0", name="retention_nonnegative"),
    )
    op.create_index(
        "uq_photo_verifications_pending",
        "photo_verifications",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("state = 'pending'"),
    )
    op.create_index(
        "ix_photo_verifications_state_created", "photo_verifications", ["state", "created_at", "id"]
    )
    op.create_index(
        "ix_photo_verifications_user_created",
        "photo_verifications",
        ["user_id", "created_at", "id"],
    )
    op.create_index("ix_photo_verifications_purge", "photo_verifications", ["purge_at"])
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON photo_verifications TO poidem_app")


def downgrade():
    raise RuntimeError("Нельзя молча удалить историю согласий и ручных решений")
