"""Create boss_state table

Revision ID: 01_create_boss_state
Revises: None
Create Date: 2026-08-21 04:45:00.000000

"""

import sqlalchemy as sa
from CTFd.plugins.migrations import get_all_tables

# revision identifiers, used by Alembic.
revision = "01_create_boss_state"
down_revision = None
branch_labels = None
depends_on = None


def upgrade(op=None):
    tables = get_all_tables(op)
    if "boss_state" not in tables:
        op.create_table(
            "boss_state",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("phase", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("name", sa.String(length=80), nullable=False),
            sa.Column("current_hp", sa.Integer(), nullable=False, server_default="15000"),
            sa.Column("max_hp", sa.Integer(), nullable=False, server_default="15000"),
            sa.Column("total_damage", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("state", sa.String(length=32), nullable=False, server_default="idle"),
            sa.Column("last_hit_by", sa.String(length=80), nullable=True),
            sa.Column("last_hit_at", sa.DateTime(), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
            sa.PrimaryKeyConstraint("id"),
        )


def downgrade(op=None):
    tables = get_all_tables(op)
    if "boss_state" in tables:
        op.drop_table("boss_state")
