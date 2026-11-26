"""D62: роли, редакционные идеи и heartbeat существующего процесса бота."""

import sqlalchemy as sa
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None

SEEDS = (
    (
        "art-evening",
        "Искусство быть рядом",
        "Красивое свидание не требует сценария. Но иногда с ним проще",
        "experiences",
        "Творческая мастерская · Москва",
        "Арт-свидание вдвоём",
        "Делать что-то впервые",
        "/images/art.jpeg",
    ),
    (
        "slow-dinner",
        "Вечер со вкусом",
        "Приглушённый свет, любимая еда и ещё один повод задержаться",
        "food",
        "Cavita · Москва",
        "Вечер в Cavita",
        "Для разговоров обо всём",
        "/images/wine.jpeg",
    ),
    (
        "gallery-date",
        "Смотреть в одну сторону",
        "Найти свою картину. А может быть, и своего человека",
        "art",
        "Галерея на Волхонке · Москва",
        "Вместе на выставку",
        "Вдохновляться вдвоём",
        "/images/gallery.jpeg",
    ),
)


def upgrade():
    # Новые роли не назначаются миграцией никому.
    op.drop_constraint(op.f("ck_users_role_code"), "users", type_="check")
    op.alter_column("users", "role_code", type_=sa.String(9), existing_type=sa.String(5))
    op.create_check_constraint(
        "role_code", "users", "role_code IN ('user','analyst','moderator','admin','owner')"
    )
    op.create_table(
        "editorial_ideas",
        sa.Column("id", sa.Text(), primary_key=True),
        *[
            sa.Column(key, sa.Text(), nullable=False)
            for key in ("title", "subtitle", "place", "plan_title", "tag")
        ],
        sa.Column(
            "category_code",
            sa.Text(),
            sa.ForeignKey("categories.code", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "state",
            sa.Enum(
                "draft",
                "published",
                name="editorial_state",
                native_enum=False,
                create_constraint=True,
            ),
            nullable=False,
            server_default="draft",
        ),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("static_image", sa.Text()),
        sa.Column("image_key", sa.Text()),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT")),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("version > 0", name="version_positive"),
        sa.CheckConstraint("sort_order >= 0", name="order_nonnegative"),
        sa.CheckConstraint("image_key IS NULL OR static_image IS NULL", name="one_image"),
    )
    op.create_index(
        "ix_editorial_ideas_state_order", "editorial_ideas", ["state", "sort_order", "id"]
    )
    op.create_table(
        "bot_heartbeats",
        sa.Column("component", sa.Text(), primary_key=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("state", sa.Text(), nullable=False),
    )
    table = sa.table(
        "editorial_ideas",
        *[
            sa.column(key)
            for key in (
                "id",
                "title",
                "subtitle",
                "category_code",
                "place",
                "plan_title",
                "tag",
                "static_image",
                "sort_order",
                "state",
            )
        ],
    )
    op.bulk_insert(
        table,
        [
            dict(
                zip(
                    (
                        "id",
                        "title",
                        "subtitle",
                        "category_code",
                        "place",
                        "plan_title",
                        "tag",
                        "static_image",
                    ),
                    values,
                    strict=True,
                ),
                sort_order=n,
                state="published",
            )
            for n, values in enumerate(SEEDS)
        ],
    )
    op.execute(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON editorial_ideas, bot_heartbeats TO poidem_app"
    )


def downgrade():
    # Осознанный отказ вместо потери редакционного контента или повышения/понижения сотрудников.
    raise RuntimeError(
        "Сначала экспортируйте редакционный контент и согласуйте откат ролей; "
        "автоматический откат D62 запрещён"
    )
