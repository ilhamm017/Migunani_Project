import { Setting } from '../models';

export type CompanyTaxMode = 'pkp' | 'non_pkp';

export interface TaxConfig {
    company_tax_mode: CompanyTaxMode;
    vat_percent: number;
    pph_final_percent: number;
}

const TAX_SETTINGS_KEY = 'company_tax_config';

const DEFAULT_TAX_CONFIG: TaxConfig = {
    company_tax_mode: 'non_pkp',
    vat_percent: 11,
    pph_final_percent: 0.5
};

export class TaxConfigService {
    static async getConfig(): Promise<TaxConfig> {
        const row = await Setting.findByPk(TAX_SETTINGS_KEY);
        const value = (row?.value || {}) as Partial<TaxConfig>;
        const mode = value.company_tax_mode === 'pkp' ? 'pkp' : 'non_pkp';
        const vat = Number(value.vat_percent);
        const pph = Number(value.pph_final_percent);
        return {
            company_tax_mode: mode,
            vat_percent: Number.isFinite(vat) && vat >= 0 ? vat : DEFAULT_TAX_CONFIG.vat_percent,
            pph_final_percent: Number.isFinite(pph) && pph >= 0 ? pph : DEFAULT_TAX_CONFIG.pph_final_percent
        };
    }

    static async ensureDefaults() {
        await Setting.findOrCreate({
            where: { key: TAX_SETTINGS_KEY },
            defaults: {
                key: TAX_SETTINGS_KEY,
                value: DEFAULT_TAX_CONFIG,
                description: 'Tax mode and rates for company (Indonesia)'
            }
        });
    }
}

export const computeInvoiceTax = (subtotal: number, config: TaxConfig) => {
    const safeSubtotal = Math.max(0, Number(subtotal || 0));
    if (config.company_tax_mode === 'pkp') {
        const taxAmount = Math.round((safeSubtotal * (config.vat_percent / 100)) * 100) / 100;
        return {
            tax_mode_snapshot: 'pkp' as const,
            tax_percent: Number(config.vat_percent || 0),
            tax_amount: taxAmount,
            pph_final_amount: null,
            total: safeSubtotal + taxAmount
        };
    }

    const pphFinalAmount = Math.round((safeSubtotal * (config.pph_final_percent / 100)) * 100) / 100;
    return {
        tax_mode_snapshot: 'non_pkp' as const,
        tax_percent: Number(config.pph_final_percent || 0),
        tax_amount: 0,
        pph_final_amount: pphFinalAmount,
        total: safeSubtotal
    };
};
