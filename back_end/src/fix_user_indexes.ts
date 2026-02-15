
import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

const sequelize = new Sequelize(
    process.env.DB_NAME as string,
    process.env.DB_USER as string,
    process.env.DB_PASS as string,
    {
        host: process.env.DB_HOST,
        dialect: 'mysql',
        logging: console.log,
    }
);

const fixIndexes = async () => {
    try {
        await sequelize.authenticate();
        console.log('Connected to database.');

        // Helper function to clean indexes
        const cleanTableIndexes = async (tableName: string, columnName: string) => {
            console.log(`Checking table '${tableName}' column '${columnName}'...`);
            const [results] = await sequelize.query(`SHOW INDEX FROM ${tableName}`);
            const indexes = results as any[];

            const relevantIndexes = indexes.filter((idx: any) =>
                idx.Column_name === columnName && idx.Key_name !== 'PRIMARY'
            );

            console.log(`Found ${relevantIndexes.length} indexes on ${tableName}.${columnName}.`);

            for (const idx of relevantIndexes) {
                const indexName = idx.Key_name;
                // Only drop if it looks like a generated duplicate or non-standard name, 
                // OR drop ALL to let sequelize rebuild the correct one.
                // Given the error, dropping ALL is safest.
                console.log(`Dropping index: ${indexName} from ${tableName}`);
                try {
                    await sequelize.query(`DROP INDEX \`${indexName}\` ON ${tableName}`);
                    console.log(`Dropped ${indexName}`);
                } catch (e: any) {
                    console.error(`Failed to drop ${indexName}:`, e.message);
                }
            }
        };

        // Fix users table
        await cleanTableIndexes('users', 'whatsapp_number');

        // Fix products table
        await cleanTableIndexes('products', 'sku');

        console.log('Cleanup complete. Now you can restart the server.');
        process.exit(0);

    } catch (error) {
        console.error('Error fixing indexes:', error);
        process.exit(1);
    }
};

fixIndexes();
