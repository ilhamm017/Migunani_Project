import { SupplierInvoice, SupplierPayment, sequelize } from '../models';

async function syncSupplierTables() {
    try {
        console.log('🔄 Syncing Supplier Invoice & Payment tables...');
        await SupplierInvoice.sync({ alter: true });
        await SupplierPayment.sync({ alter: true });
        console.log('✅ Supplier tables synced successfully.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error syncing Supplier tables:', error);
        process.exit(1);
    }
}

syncSupplierTables();
