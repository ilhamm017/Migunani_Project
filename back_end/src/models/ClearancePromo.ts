import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

export type ClearancePromoPricingMode = 'fixed_price' | 'percent_off';

interface ClearancePromoAttributes {
    id: string; // UUID
    name: string;
    product_id: string; // UUID
    target_unit_cost: number;
    pricing_mode: ClearancePromoPricingMode;
    promo_unit_price: number | null;
    discount_pct: number | null;
    starts_at: Date;
    ends_at: Date;
    is_active: boolean;
    created_by: string | null;
    updated_by: string | null;
}

interface ClearancePromoCreationAttributes extends Optional<ClearancePromoAttributes, 'id' | 'promo_unit_price' | 'discount_pct' | 'is_active' | 'created_by' | 'updated_by'> { }

class ClearancePromo extends Model<ClearancePromoAttributes, ClearancePromoCreationAttributes> implements ClearancePromoAttributes {
    declare id: string;
    declare name: string;
    declare product_id: string;
    declare target_unit_cost: number;
    declare pricing_mode: ClearancePromoPricingMode;
    declare promo_unit_price: number | null;
    declare discount_pct: number | null;
    declare starts_at: Date;
    declare ends_at: Date;
    declare is_active: boolean;
    declare created_by: string | null;
    declare updated_by: string | null;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

ClearancePromo.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        name: {
            type: DataTypes.STRING(120),
            allowNull: false,
        },
        product_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        target_unit_cost: {
            type: DataTypes.DECIMAL(15, 4),
            allowNull: false,
        },
        pricing_mode: {
            type: DataTypes.ENUM('fixed_price', 'percent_off'),
            allowNull: false,
        },
        promo_unit_price: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: true,
        },
        discount_pct: {
            type: DataTypes.DECIMAL(5, 2),
            allowNull: true,
        },
        starts_at: {
            type: DataTypes.DATE,
            allowNull: false,
        },
        ends_at: {
            type: DataTypes.DATE,
            allowNull: false,
        },
        is_active: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
        },
        created_by: {
            type: DataTypes.UUID,
            allowNull: true,
        },
        updated_by: {
            type: DataTypes.UUID,
            allowNull: true,
        },
    },
    {
        sequelize,
        tableName: 'clearance_promos',
        indexes: [
            { fields: ['product_id'] },
            { fields: ['is_active', 'starts_at', 'ends_at'] },
        ]
    }
);

export default ClearancePromo;

