import { sequelize } from '../models';

export const up = async (ctx: { sequelize: typeof sequelize }) => {
    // Create missing tables only (non-destructive for existing DB).
    // This moves initial table creation out of runtime startup and into explicit migration step.
    await ctx.sequelize.sync();
};

export const down = async (_ctx: { sequelize: typeof sequelize }) => {
    // Intentionally no-op: rolling back "bootstrap" would be destructive (dropping many tables).
};

