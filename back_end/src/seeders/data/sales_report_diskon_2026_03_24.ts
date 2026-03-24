/* eslint-disable */
// AUTO-GENERATED. Do not edit manually.
// Source: Laporan Penjualan_24-03-2026sd24-03-2026@24-03-2026 12-15-15_diskon.xlsx
// Generated at: 2026-03-24T11:50:36.342Z

export const salesReportDiskonSeedMeta = {
    "generated_at": "2026-03-24T11:50:36.342Z",
    "source_file": "Laporan Penjualan_24-03-2026sd24-03-2026@24-03-2026 12-15-15_diskon.xlsx",
    "invoice_count": 11,
    "item_count": 91
} as const;

export type SalesReportDiskonSeedInvoice = {
    invoice_no: string;
    date: string; // ISO
    customer_name: string;
    bruto: number;
    diskon: number;
    netto: number;
    items: Array<{
        product_name: string;
        cost_per_unit: number;
        price_per_unit: number;
        qty: number;
        discount_amount: number;
        subtotal: number;
        note: string | null;
        discount_pct: number;
    }>;
};

export const salesReportDiskonSeedInvoices: SalesReportDiskonSeedInvoice[] = [
    {
        "invoice_no": "INV-26030541",
        "date": "2026-03-23T17:00:00.000Z",
        "customer_name": "Eko dlingo",
        "bruto": 780000,
        "diskon": 0,
        "netto": 780000,
        "items": [
            {
                "product_name": "IRC 250-17 NF47 TT.",
                "cost_per_unit": 138305,
                "price_per_unit": 141500,
                "qty": 1,
                "discount_amount": 0,
                "subtotal": 141500,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "Irc 275-17 nr60 TT.",
                "cost_per_unit": 172360,
                "price_per_unit": 176500,
                "qty": 1,
                "discount_amount": 0,
                "subtotal": 176500,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "Irc 90/90-14 nr83 TL.",
                "cost_per_unit": 207555,
                "price_per_unit": 213000,
                "qty": 1,
                "discount_amount": 0,
                "subtotal": 213000,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "IRC 100/80-14 SCT006 TL",
                "cost_per_unit": 243175,
                "price_per_unit": 249000,
                "qty": 1,
                "discount_amount": 0,
                "subtotal": 249000,
                "note": null,
                "discount_pct": 0
            }
        ]
    },
    {
        "invoice_no": "INV-26030542",
        "date": "2026-03-23T17:00:00.000Z",
        "customer_name": "Abdi jaya",
        "bruto": 2557700,
        "diskon": 0,
        "netto": 2557700,
        "items": [
            {
                "product_name": "Shell ax7 0,8 metic 10w-30",
                "cost_per_unit": 45475,
                "price_per_unit": 44000,
                "qty": 1,
                "discount_amount": 0,
                "subtotal": 44000,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "IRC 100/80-14 SCT006 TL",
                "cost_per_unit": 243175,
                "price_per_unit": 355000,
                "qty": 1,
                "discount_amount": 106500,
                "subtotal": 248500,
                "note": "Diskon 30%",
                "discount_pct": 30
            },
            {
                "product_name": "IRC 80/90-17 ENVIRO NR91 TL",
                "cost_per_unit": 212350,
                "price_per_unit": 310000,
                "qty": 1,
                "discount_amount": 93000,
                "subtotal": 217000,
                "note": "Diskon 30%",
                "discount_pct": 30
            },
            {
                "product_name": "IRC 130/70-13 SS-560R TL.",
                "cost_per_unit": 301400,
                "price_per_unit": 440000,
                "qty": 1,
                "discount_amount": 132000,
                "subtotal": 308000,
                "note": "Diskon 30%",
                "discount_pct": 30
            },
            {
                "product_name": "IRC 110/70-13 SS570F TL.",
                "cost_per_unit": 239750,
                "price_per_unit": 350000,
                "qty": 1,
                "discount_amount": 105000,
                "subtotal": 245000,
                "note": "Diskon 30%",
                "discount_pct": 30
            },
            {
                "product_name": "IRC 110/90-12 MB67 TL.",
                "cost_per_unit": 247970,
                "price_per_unit": 362000,
                "qty": 1,
                "discount_amount": 108600,
                "subtotal": 253400,
                "note": "Diskon 30%",
                "discount_pct": 30
            },
            {
                "product_name": "IRC 100/90-12 MB86 TL.",
                "cost_per_unit": 200020,
                "price_per_unit": 292000,
                "qty": 1,
                "discount_amount": 87600,
                "subtotal": 204400,
                "note": "Diskon 30%",
                "discount_pct": 30
            },
            {
                "product_name": "IRC 90/90-14 SS-530R TL.",
                "cost_per_unit": 207555,
                "price_per_unit": 303000,
                "qty": 1,
                "discount_amount": 90900,
                "subtotal": 212100,
                "note": "Diskon 30%",
                "discount_pct": 30
            },
            {
                "product_name": "Irc 90/90-14 enviro NR91 TL",
                "cost_per_unit": 207555,
                "price_per_unit": 303000,
                "qty": 1,
                "discount_amount": 90900,
                "subtotal": 212100,
                "note": "Diskon 30%",
                "discount_pct": 30
            },
            {
                "product_name": "Irc 90/90-14 ecotrax NR96 TL.",
                "cost_per_unit": 207555,
                "price_per_unit": 303000,
                "qty": 1,
                "discount_amount": 90900,
                "subtotal": 212100,
                "note": "Diskon 30%",
                "discount_pct": 30
            },
            {
                "product_name": "Irc 90/90-14 nr83 TL.",
                "cost_per_unit": 207555,
                "price_per_unit": 303000,
                "qty": 1,
                "discount_amount": 90900,
                "subtotal": 212100,
                "note": "Diskon 30%",
                "discount_pct": 30
            },
            {
                "product_name": "IRC 80/90-14 NF66 TL.",
                "cost_per_unit": 184950,
                "price_per_unit": 270000,
                "qty": 1,
                "discount_amount": 81000,
                "subtotal": 189000,
                "note": "Diskon 30%",
                "discount_pct": 30
            }
        ]
    },
    {
        "invoice_no": "INV-26030543",
        "date": "2026-03-23T17:00:00.000Z",
        "customer_name": "agung terong",
        "bruto": 3412500,
        "diskon": 0,
        "netto": 3412500,
        "items": [
            {
                "product_name": "IRC 80/90-17 NR69 TT.",
                "cost_per_unit": 177225,
                "price_per_unit": 182000,
                "qty": 1,
                "discount_amount": 0,
                "subtotal": 182000,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "43130-KZL-930 Kampas belakang kzl ahm",
                "cost_per_unit": 41070,
                "price_per_unit": 46500,
                "qty": 3,
                "discount_amount": 0,
                "subtotal": 139500,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "Oli gardan aspira",
                "cost_per_unit": 0,
                "price_per_unit": 9500,
                "qty": 10,
                "discount_amount": 0,
                "subtotal": 95000,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "Mpx1 0,8.",
                "cost_per_unit": 48000,
                "price_per_unit": 49000,
                "qty": 2,
                "discount_amount": 0,
                "subtotal": 98000,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "Yamalube sport 1L",
                "cost_per_unit": 51000,
                "price_per_unit": 52500,
                "qty": 2,
                "discount_amount": 0,
                "subtotal": 105000,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "yamalube matic 0,8.",
                "cost_per_unit": 41000,
                "price_per_unit": 43000,
                "qty": 3,
                "discount_amount": 0,
                "subtotal": 129000,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "Shell ax5 1L 15w-40",
                "cost_per_unit": 44850,
                "price_per_unit": 44500,
                "qty": 3,
                "discount_amount": 0,
                "subtotal": 133500,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "shell ax7 0,8 10w-40",
                "cost_per_unit": 46000,
                "price_per_unit": 45000,
                "qty": 3,
                "discount_amount": 0,
                "subtotal": 135000,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "Shell ax7 1L 10w-40",
                "cost_per_unit": 53425,
                "price_per_unit": 52000,
                "qty": 3,
                "discount_amount": 0,
                "subtotal": 156000,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "Shell ax7 0,8 metic 10w-30",
                "cost_per_unit": 45475,
                "price_per_unit": 44500,
                "qty": 5,
                "discount_amount": 0,
                "subtotal": 222500,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "Mpx2 0,8.",
                "cost_per_unit": 49000,
                "price_per_unit": 50500,
                "qty": 5,
                "discount_amount": 0,
                "subtotal": 252500,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "H2-45530-471-1100 Seal master rem 471 aspira",
                "cost_per_unit": 16201,
                "price_per_unit": 17000,
                "qty": 4,
                "discount_amount": 0,
                "subtotal": 68000,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "pad set JMX 2700 federal.",
                "cost_per_unit": 15120,
                "price_per_unit": 16500,
                "qty": 4,
                "discount_amount": 0,
                "subtotal": 66000,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "ban dalam irc 250-17",
                "cost_per_unit": 0,
                "price_per_unit": 29500,
                "qty": 3,
                "discount_amount": 0,
                "subtotal": 88500,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "Ban dalam 275-17 (80/90-17) irc",
                "cost_per_unit": 28220,
                "price_per_unit": 34000,
                "qty": 4,
                "discount_amount": 0,
                "subtotal": 136000,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "IRC 70/90-17 NR69 TT.",
                "cost_per_unit": 145950,
                "price_per_unit": 149500,
                "qty": 1,
                "discount_amount": 0,
                "subtotal": 149500,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "IRC 275-17 SP1H TT.",
                "cost_per_unit": 172360,
                "price_per_unit": 176500,
                "qty": 1,
                "discount_amount": 0,
                "subtotal": 176500,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "IRC 110/90-12 MB67 TL.",
                "cost_per_unit": 247970,
                "price_per_unit": 253500,
                "qty": 1,
                "discount_amount": 0,
                "subtotal": 253500,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "IRC 80/90-14 NF66 TL.",
                "cost_per_unit": 184950,
                "price_per_unit": 189000,
                "qty": 1,
                "discount_amount": 0,
                "subtotal": 189000,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "Irc 90/90-14 nr83 TL.",
                "cost_per_unit": 207555,
                "price_per_unit": 212500,
                "qty": 3,
                "discount_amount": 0,
                "subtotal": 637500,
                "note": null,
                "discount_pct": 0
            }
        ]
    },
    {
        "invoice_no": "INV-26030544",
        "date": "2026-03-23T17:00:00.000Z",
        "customer_name": "AB MOTOR",
        "bruto": 740000,
        "diskon": 0,
        "netto": 740000,
        "items": [
            {
                "product_name": "Carburator cleaner 500ml federal.",
                "cost_per_unit": 21870,
                "price_per_unit": 24000,
                "qty": 5,
                "discount_amount": 0,
                "subtotal": 120000,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "H2-17210-K16-1710 filter udara k16 aspira",
                "cost_per_unit": 32400,
                "price_per_unit": 33500,
                "qty": 2,
                "discount_amount": 0,
                "subtotal": 67000,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "IRC 130/70-13 SS-560R TL.",
                "cost_per_unit": 301400,
                "price_per_unit": 440000,
                "qty": 1,
                "discount_amount": 132000,
                "subtotal": 308000,
                "note": "Diskon 30%",
                "discount_pct": 30
            },
            {
                "product_name": "IRC 110/70-13 SS570F TL.",
                "cost_per_unit": 239750,
                "price_per_unit": 350000,
                "qty": 1,
                "discount_amount": 105000,
                "subtotal": 245000,
                "note": "Diskon 30%",
                "discount_pct": 30
            }
        ]
    },
    {
        "invoice_no": "INV-26030545",
        "date": "2026-03-23T17:00:00.000Z",
        "customer_name": "KAMTO MOTOR",
        "bruto": 1318000,
        "diskon": 0,
        "netto": 1318000,
        "items": [
            {
                "product_name": "91211-GK8-013 34x39x3",
                "cost_per_unit": 8505,
                "price_per_unit": 10500,
                "qty": 10,
                "discount_amount": 0,
                "subtotal": 105000,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "91211-KN7-671 Seal pully 34X41X4",
                "cost_per_unit": 9750,
                "price_per_unit": 12000,
                "qty": 10,
                "discount_amount": 0,
                "subtotal": 120000,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "Mpx2 0,65.",
                "cost_per_unit": 42000,
                "price_per_unit": 43500,
                "qty": 4,
                "discount_amount": 0,
                "subtotal": 174000,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "42711K59A12 AHM 90/90-14 TL",
                "cost_per_unit": 216810,
                "price_per_unit": 220000,
                "qty": 1,
                "discount_amount": 0,
                "subtotal": 220000,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "Oring tutup klep yamaha",
                "cost_per_unit": 0,
                "price_per_unit": 1000,
                "qty": 8,
                "discount_amount": 0,
                "subtotal": 8000,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "Busi PZ11HC federal",
                "cost_per_unit": 13100,
                "price_per_unit": 14500,
                "qty": 4,
                "discount_amount": 0,
                "subtotal": 58000,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "bohlam lampu depan 5ll yamaha.",
                "cost_per_unit": 11383,
                "price_per_unit": 13500,
                "qty": 10,
                "discount_amount": 0,
                "subtotal": 135000,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "42100-K0J00 rotak genio npp",
                "cost_per_unit": 101010,
                "price_per_unit": 125000,
                "qty": 2,
                "discount_amount": 0,
                "subtotal": 250000,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "vakum karbu kvb ahm 16111KVB903",
                "cost_per_unit": 0,
                "price_per_unit": 128000,
                "qty": 1,
                "discount_amount": 0,
                "subtotal": 128000,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "kiprok vario ahm",
                "cost_per_unit": 99960,
                "price_per_unit": 120000,
                "qty": 1,
                "discount_amount": 0,
                "subtotal": 120000,
                "note": null,
                "discount_pct": 0
            }
        ]
    },
    {
        "invoice_no": "INV-26030546",
        "date": "2026-03-23T17:00:00.000Z",
        "customer_name": "Sinar motor",
        "bruto": 2261040,
        "diskon": 0,
        "netto": 2261040,
        "items": [
            {
                "product_name": "Irc 80/90-14 nr76 TT",
                "cost_per_unit": 141780,
                "price_per_unit": 204000,
                "qty": 1,
                "discount_amount": 59160,
                "subtotal": 144840,
                "note": "Diskon 29%",
                "discount_pct": 29
            },
            {
                "product_name": "Irc 80/90-14 ss530f Tt.",
                "cost_per_unit": 141780,
                "price_per_unit": 204000,
                "qty": 1,
                "discount_amount": 59160,
                "subtotal": 144840,
                "note": "Diskon 29%",
                "discount_pct": 29
            },
            {
                "product_name": "IRC 225-17 NR72 TT",
                "cost_per_unit": 118150,
                "price_per_unit": 170000,
                "qty": 1,
                "discount_amount": 49300,
                "subtotal": 120700,
                "note": "Diskon 29%",
                "discount_pct": 29
            },
            {
                "product_name": "IRC 250-17 NF47 TT.",
                "cost_per_unit": 138305,
                "price_per_unit": 199000,
                "qty": 2,
                "discount_amount": 115420,
                "subtotal": 282580,
                "note": "Diskon 29%",
                "discount_pct": 29
            },
            {
                "product_name": "42711K59A12 AHM 90/90-14 TL",
                "cost_per_unit": 216810,
                "price_per_unit": 297000,
                "qty": 2,
                "discount_amount": 154440,
                "subtotal": 439560,
                "note": null,
                "discount_pct": 26
            },
            {
                "product_name": "IRC 90/90-14 SS-530R TL.",
                "cost_per_unit": 207555,
                "price_per_unit": 303000,
                "qty": 2,
                "discount_amount": 181800,
                "subtotal": 424200,
                "note": "Diskon 30%",
                "discount_pct": 30
            },
            {
                "product_name": "Irc 275-17 nr72 TT",
                "cost_per_unit": 172360,
                "price_per_unit": 248000,
                "qty": 1,
                "discount_amount": 71920,
                "subtotal": 176080,
                "note": "Diskon 29%",
                "discount_pct": 29
            },
            {
                "product_name": "IRC 275-17 SP1H TT.",
                "cost_per_unit": 172360,
                "price_per_unit": 248000,
                "qty": 1,
                "discount_amount": 71920,
                "subtotal": 176080,
                "note": "Diskon 29%",
                "discount_pct": 29
            },
            {
                "product_name": "Irc 275-17 nr60 TT.",
                "cost_per_unit": 172360,
                "price_per_unit": 248000,
                "qty": 2,
                "discount_amount": 143840,
                "subtotal": 352160,
                "note": "Diskon 29%",
                "discount_pct": 29
            }
        ]
    },
    {
        "invoice_no": "INV-26030547",
        "date": "2026-03-23T17:00:00.000Z",
        "customer_name": "Tabah motor",
        "bruto": 2258140,
        "diskon": 0,
        "netto": 2258140,
        "items": [
            {
                "product_name": "MAXXIS 80/90-14 MA-3DN TL",
                "cost_per_unit": 188860,
                "price_per_unit": 266000,
                "qty": 2,
                "discount_amount": 138320,
                "subtotal": 393680,
                "note": "Diskon 26%",
                "discount_pct": 26
            },
            {
                "product_name": "Ban dalam 225/250-17 (70/90-17) irc",
                "cost_per_unit": 28220,
                "price_per_unit": 30000,
                "qty": 5,
                "discount_amount": 0,
                "subtotal": 150000,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "Ban dalam 275-17 (80/90-17) irc",
                "cost_per_unit": 28220,
                "price_per_unit": 34000,
                "qty": 5,
                "discount_amount": 0,
                "subtotal": 170000,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "44711KTM850 AHM 70/90-17 TT",
                "cost_per_unit": 146730,
                "price_per_unit": 201000,
                "qty": 1,
                "discount_amount": 52260,
                "subtotal": 148740,
                "note": null,
                "discount_pct": 26
            },
            {
                "product_name": "42711KVB931 AHM 90/90-14 TT",
                "cost_per_unit": 177390,
                "price_per_unit": 243000,
                "qty": 1,
                "discount_amount": 63180,
                "subtotal": 179820,
                "note": null,
                "discount_pct": 26
            },
            {
                "product_name": "44711K59A12 AHM 80/90-14 TL",
                "cost_per_unit": 191990,
                "price_per_unit": 263000,
                "qty": 1,
                "discount_amount": 68380,
                "subtotal": 194620,
                "note": null,
                "discount_pct": 26
            },
            {
                "product_name": "42711K59A12 AHM 90/90-14 TL",
                "cost_per_unit": 216810,
                "price_per_unit": 297000,
                "qty": 1,
                "discount_amount": 77220,
                "subtotal": 219780,
                "note": null,
                "discount_pct": 26
            },
            {
                "product_name": "mesran super 0.8",
                "cost_per_unit": 36491,
                "price_per_unit": 37500,
                "qty": 1,
                "discount_amount": 0,
                "subtotal": 37500,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "Shell AX7 0,65 metic 10w-30",
                "cost_per_unit": 36725,
                "price_per_unit": 36500,
                "qty": 2,
                "discount_amount": 0,
                "subtotal": 73000,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "Shell ax7 0,8 metic 10w-30",
                "cost_per_unit": 45475,
                "price_per_unit": 44500,
                "qty": 4,
                "discount_amount": 0,
                "subtotal": 178000,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "federal ultratec 0,8.",
                "cost_per_unit": 39250,
                "price_per_unit": 41500,
                "qty": 6,
                "discount_amount": 0,
                "subtotal": 249000,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "Prima xp 1L",
                "cost_per_unit": 41768,
                "price_per_unit": 44000,
                "qty": 6,
                "discount_amount": 0,
                "subtotal": 264000,
                "note": null,
                "discount_pct": 0
            }
        ]
    },
    {
        "invoice_no": "INV-26030548",
        "date": "2026-03-23T17:00:00.000Z",
        "customer_name": "paijo",
        "bruto": 1435260,
        "diskon": 0,
        "netto": 1435260,
        "items": [
            {
                "product_name": "Shell ax3 1L 20w-50",
                "cost_per_unit": 42775,
                "price_per_unit": 42500,
                "qty": 5,
                "discount_amount": 0,
                "subtotal": 212500,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "IRC 130/70-13 SS-560R TL.",
                "cost_per_unit": 301400,
                "price_per_unit": 440000,
                "qty": 1,
                "discount_amount": 132000,
                "subtotal": 308000,
                "note": "Diskon 30%",
                "discount_pct": 30
            },
            {
                "product_name": "IRC 80/90-14 SS-530F TL.",
                "cost_per_unit": 184950,
                "price_per_unit": 270000,
                "qty": 2,
                "discount_amount": 162000,
                "subtotal": 378000,
                "note": "Diskon 30%",
                "discount_pct": 30
            },
            {
                "product_name": "IRC 90/90-14 SS-530R TT.",
                "cost_per_unit": 175140,
                "price_per_unit": 252000,
                "qty": 3,
                "discount_amount": 219240,
                "subtotal": 536760,
                "note": "Diskon 29%",
                "discount_pct": 29
            }
        ]
    },
    {
        "invoice_no": "INV-26030551",
        "date": "2026-03-23T17:00:00.000Z",
        "customer_name": "GK 01",
        "bruto": 2311980,
        "diskon": 0,
        "netto": 2311980,
        "items": [
            {
                "product_name": "kampas belakang rc federal.",
                "cost_per_unit": 18954,
                "price_per_unit": 31000,
                "qty": 59,
                "discount_amount": 695020,
                "subtotal": 1133980,
                "note": "Diskon 38%",
                "discount_pct": 38
            },
            {
                "product_name": "FP-43125-KGA-2700 Kampas belakang KGA/VARIO federal",
                "cost_per_unit": 0,
                "price_per_unit": 38000,
                "qty": 50,
                "discount_amount": 722000,
                "subtotal": 1178000,
                "note": null,
                "discount_pct": 38
            }
        ]
    },
    {
        "invoice_no": "INV-26030552",
        "date": "2026-03-23T17:00:00.000Z",
        "customer_name": "Sansino Playen",
        "bruto": 2675700,
        "diskon": 0,
        "netto": 2675700,
        "items": [
            {
                "product_name": "Ban dalam 275-17 (80/90-17) irc",
                "cost_per_unit": 28220,
                "price_per_unit": 33500,
                "qty": 6,
                "discount_amount": 0,
                "subtotal": 201000,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "Irc 275-17 nr60 TT.",
                "cost_per_unit": 172360,
                "price_per_unit": 248000,
                "qty": 2,
                "discount_amount": 143840,
                "subtotal": 352160,
                "note": "Diskon 29%",
                "discount_pct": 29
            },
            {
                "product_name": "IRC 80/90-14 NF66 TL.",
                "cost_per_unit": 184950,
                "price_per_unit": 270000,
                "qty": 2,
                "discount_amount": 162000,
                "subtotal": 378000,
                "note": "Diskon 30%",
                "discount_pct": 30
            },
            {
                "product_name": "Irc 90/90-14 nr83 TL.",
                "cost_per_unit": 207555,
                "price_per_unit": 303000,
                "qty": 2,
                "discount_amount": 181800,
                "subtotal": 424200,
                "note": "Diskon 30%",
                "discount_pct": 30
            },
            {
                "product_name": "42711K93N02 AHM 110/90-12 TL",
                "cost_per_unit": 253310,
                "price_per_unit": 347000,
                "qty": 1,
                "discount_amount": 90220,
                "subtotal": 256780,
                "note": null,
                "discount_pct": 26
            },
            {
                "product_name": "MAXXIS 110/90-12 M922R TL",
                "cost_per_unit": 257730,
                "price_per_unit": 363000,
                "qty": 1,
                "discount_amount": 94380,
                "subtotal": 268620,
                "note": "Diskon 26%",
                "discount_pct": 26
            },
            {
                "product_name": "MAXXIS 90/80-17 MA-G1 TL",
                "cost_per_unit": 307430,
                "price_per_unit": 433000,
                "qty": 1,
                "discount_amount": 112580,
                "subtotal": 320420,
                "note": "Diskon 26%",
                "discount_pct": 26
            },
            {
                "product_name": "MAXXIS 80/90-17 VICTRA S98 ST TL",
                "cost_per_unit": 0,
                "price_per_unit": 348000,
                "qty": 1,
                "discount_amount": 90480,
                "subtotal": 257520,
                "note": "Diskon 26%",
                "discount_pct": 26
            },
            {
                "product_name": "Irc 80/90-17 rx01f TL",
                "cost_per_unit": 212350,
                "price_per_unit": 310000,
                "qty": 1,
                "discount_amount": 93000,
                "subtotal": 217000,
                "note": "Diskon 30%",
                "discount_pct": 30
            }
        ]
    },
    {
        "invoice_no": "INV-26030557",
        "date": "2026-03-23T17:00:00.000Z",
        "customer_name": "Arifin bawuran",
        "bruto": 1055500,
        "diskon": 0,
        "netto": 1055500,
        "items": [
            {
                "product_name": "Knalpot grand aspira",
                "cost_per_unit": 0,
                "price_per_unit": 265000,
                "qty": 1,
                "discount_amount": 0,
                "subtotal": 265000,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "sensor tps genio npp.",
                "cost_per_unit": 86247,
                "price_per_unit": 93500,
                "qty": 2,
                "discount_amount": 0,
                "subtotal": 187000,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "ban dalam 275/300-14 federal. FP-2753001400000",
                "cost_per_unit": 22720,
                "price_per_unit": 24000,
                "qty": 3,
                "discount_amount": 0,
                "subtotal": 72000,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "IRC 130/70-13 SS-560R TL.",
                "cost_per_unit": 301400,
                "price_per_unit": 309000,
                "qty": 1,
                "discount_amount": 0,
                "subtotal": 309000,
                "note": null,
                "discount_pct": 0
            },
            {
                "product_name": "Shell ax7 0,8 metic 10w-30",
                "cost_per_unit": 45475,
                "price_per_unit": 44500,
                "qty": 5,
                "discount_amount": 0,
                "subtotal": 222500,
                "note": null,
                "discount_pct": 0
            }
        ]
    }
];
