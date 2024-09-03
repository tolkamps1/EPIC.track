"""add eac signed and expires fields to project

Revision ID: 08209ce361c2
Revises: 19227722dffc
Create Date: 2024-08-29 08:45:46.100404

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '08209ce361c2'
down_revision = '19227722dffc'
branch_labels = None
depends_on = None


def upgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    with op.batch_alter_table('projects', schema=None) as batch_op:
        batch_op.add_column(sa.Column('eac_signed', sa.Date(), nullable=True))
        batch_op.add_column(sa.Column('eac_expires', sa.Date(), nullable=True))

    with op.batch_alter_table('projects_history', schema=None) as batch_op:
        batch_op.add_column(sa.Column('eac_signed', sa.Date(), autoincrement=False, nullable=True))
        batch_op.add_column(sa.Column('eac_expires', sa.Date(), autoincrement=False, nullable=True))
    # ### end Alembic commands ###


def downgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    with op.batch_alter_table('projects_history', schema=None) as batch_op:
        batch_op.drop_column('eac_expires')
        batch_op.drop_column('eac_signed')

    with op.batch_alter_table('projects', schema=None) as batch_op:
        batch_op.drop_column('eac_expires')
        batch_op.drop_column('eac_signed')
    # ### end Alembic commands ###
