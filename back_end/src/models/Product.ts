import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface ProductAttributes {
    id: string; // UUID
    sku: string;
    barcode?: string | null;
    name: string;
    description?: string | null;
    image_url?: string | null;
    base_price: number;
    price: number;
    unit: string;
    stock_quantity: number;
    allocated_quantity: number;
    min_stock: number;
    category_id: number;
    status: 'active' | 'inactive';
    keterangan?: string | null;
    tipe_modal?: string | null;
    varian_harga?: unknown | null;
    grosir?: unknown | null;
    total_modal?: number | null;
    bin_location?: string | null;
    vehicle_compatibility?: string | null;
}

interface ProductCreationAttributes extends Optional<ProductAttributes, 'id' | 'status' | 'barcode' | 'description' | 'image_url' | 'base_price' | 'price' | 'unit' | 'stock_quantity' | 'allocated_quantity' | 'min_stock' | 'keterangan' | 'tipe_modal' | 'varian_harga' | 'grosir' | 'total_modal'> { }

class Product extends Model<ProductAttributes, ProductCreationAttributes> implements ProductAttributes {
    declare id: string;
    declare sku: string;
    declare barcode: string | null;
    declare name: string;
    declare description: string | null;
    declare image_url: string | null;
    declare base_price: number;
    declare price: number;
    declare unit: string;
    declare stock_quantity: number;
    declare allocated_quantity: number;
    declare min_stock: number;
    declare category_id: number;
    declare status: 'active' | 'inactive';
    declare keterangan: string | null;
    declare tipe_modal: string | null;
    declare varian_harga: unknown | null;
    declare grosir: unknown | null;
    declare total_modal: number | null;
    declare bin_location: string | null;
    declare vehicle_compatibility: string | null;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

Product.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        sku: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
        },
        barcode: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        image_url: {
            type: DataTypes.STRING(2048),
            allowNull: true,
        },
        base_price: {
            type: DataTypes.DECIMAL(15, 2),
            defaultValue: 0,
        },
        price: {
            type: DataTypes.DECIMAL(15, 2),
            defaultValue: 0,
        },
        unit: {
            type: DataTypes.STRING,
            defaultValue: 'Pcs',
        },
        stock_quantity: {
            type: DataTypes.INTEGER,
            defaultValue: 0,
        },
        allocated_quantity: {
            type: DataTypes.INTEGER,
            defaultValue: 0,
        },
        min_stock: {
            type: DataTypes.INTEGER,
            defaultValue: 5,
        },
        category_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        status: {
            type: DataTypes.ENUM('active', 'inactive'),
            defaultValue: 'active',
        },
        keterangan: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        tipe_modal: {
            type: DataTypes.STRING(50),
            allowNull: true,
        },
        varian_harga: {
            type: DataTypes.JSON,
            allowNull: true,
        },
        grosir: {
            type: DataTypes.JSON,
            allowNull: true,
        },
        total_modal: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: true,
        },
        bin_location: {
            type: DataTypes.STRING(50),
            allowNull: true,
        },
        vehicle_compatibility: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
    },
    {
        sequelize,
        tableName: 'products',
        indexes: [
            { unique: true, fields: ['sku'] },
            { fields: ['barcode'] }
        ]
    }
);

export default Product;
