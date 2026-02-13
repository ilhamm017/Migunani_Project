import ExcelJS from 'exceljs';
import { Product, Category, StockMutation } from '../models';
import sequelize from '../config/database';

async function importExcel(filePath: string) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.getWorksheet(1); // Assuming first sheet

    if (!worksheet) {
        console.error('No worksheet found!');
        return;
    }

    const transaction = await sequelize.transaction();

    try {
        // We cannot use 'eachRow' easily if we want to await async operations correctly in strict sequence or parallel without issues inside the callback.
        // Better to iterate rows manually or use mapping.

        // However, for this script, standard for loop over rows is safer for async.
        const rows: ExcelJS.Row[] = [];
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber > 1) rows.push(row);
        });

        for (const row of rows) {
            // Mapping matching the Technical Design
            // NAMA BARANG, VARIAN, KATEGORI BARANG, HARGA BELI, HARGA JUAL, SKU, UNIT, BARCODE, STATUS, STOK.
            const namaBarang = row.getCell(1).text;
            const varian = row.getCell(2).text;
            const kategori = row.getCell(3).text;
            const hargaBeliRaw = row.getCell(4).value;
            const hargaJualRaw = row.getCell(5).value;
            const skuRaw = row.getCell(6).text;
            const unit = row.getCell(7).text || 'Pcs';
            const barcodeRaw = row.getCell(8).text;
            const statusRaw = row.getCell(9).text;
            const stokRaw = row.getCell(10).value;

            // Logic: Name
            const name = varian ? `${namaBarang} ${varian}` : namaBarang;
            if (!name) continue; // Skip empty rows

            // Logic: Category
            let categoryId: number = 0;
            if (kategori) {
                let category = await Category.findOne({ where: { name: kategori }, transaction });
                if (!category) {
                    category = await Category.create({ name: kategori }, { transaction });
                }
                categoryId = category.id;
            }

            // Logic: Prices (Clean currency)
            const base_price = typeof hargaBeliRaw === 'number' ? hargaBeliRaw : parseFloat(String(hargaBeliRaw).replace(/[^0-9.-]+/g, "")) || 0;
            const price = typeof hargaJualRaw === 'number' ? hargaJualRaw : parseFloat(String(hargaJualRaw).replace(/[^0-9.-]+/g, "")) || 0;

            // Logic: SKU & Barcode
            let sku = skuRaw;
            if (!sku) {
                // Should generate a truly unique SKU if missing, or use Barcode.
                // Fallback: Name + variant slug
                sku = barcodeRaw || name.replace(/\s+/g, '-').toUpperCase() + '-' + Date.now();
            }
            const barcode = barcodeRaw || null;

            // Logic: Stock
            const stock = typeof stokRaw === 'number' ? stokRaw : parseInt(String(stokRaw)) || 0;

            // Create Product
            let product = await Product.findOne({ where: { sku }, transaction });

            if (!product) {
                product = await Product.create({
                    sku,
                    barcode: barcode || undefined,
                    name,
                    base_price,
                    price,
                    unit,
                    stock_quantity: 0, // Initial stock 0, add via mutation
                    min_stock: 5,
                    category_id: categoryId,
                    status: (statusRaw?.toLowerCase() === 'active') ? 'active' : 'inactive'
                }, { transaction });

                // Initial Stock Mutation
                if (stock > 0) {
                    await StockMutation.create({
                        product_id: product.id,
                        type: 'initial', // Enum: 'in', 'out', 'adjustment', 'initial'
                        qty: stock,
                        note: 'Import Excel Scrapping/Migrasi',
                        reference_id: 'IMPORT-INITIAL'
                    }, { transaction });

                    await product.update({ stock_quantity: stock }, { transaction });
                }
                console.log(`Imported: ${name} (${sku})`);
            } else {
                console.log(`Skipped existing: ${sku}`);
            }
        }

        await transaction.commit();
        console.log('Import completed successfully!');
    } catch (error) {
        await transaction.rollback();
        console.error('Import failed:', error);
    }
}

// Check for CLI args
const filePath = process.argv[2];
if (filePath) {
    importExcel(filePath);
} else {
    console.log('Usage: npx ts-node src/scripts/import_excel.ts <path_to_excel_file>');
}

export default importExcel;
