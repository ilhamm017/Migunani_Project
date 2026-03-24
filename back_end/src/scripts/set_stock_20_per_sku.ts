import { Product, sequelize } from '../models';

async function main() {
  try {
    const [updatedCount] = await Product.update(
      { stock_quantity: 20 },
      { where: {}, silent: true }
    );
    console.log(`✅ Updated stock_quantity=20 for ${updatedCount} products`);
  } catch (error) {
    console.error('❌ Failed to update product stock to 20:', error);
    process.exitCode = 1;
  } finally {
    try {
      await sequelize.close();
    } catch {
      // ignore
    }
  }
}

main();

