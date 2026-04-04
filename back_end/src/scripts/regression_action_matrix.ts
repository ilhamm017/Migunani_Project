const BASE_URL = String(process.env.API_BASE_URL || 'http://127.0.0.1:5000/api/v1').replace(/\/$/, '');

export {};

type Role = 'super_admin' | 'admin_gudang' | 'admin_finance' | 'kasir' | 'driver' | 'customer';

type RoleCredential = {
  email: string;
  password: string;
};

type Expectation = {
  status: number;
  messageIncludes?: string;
};

type RegressionCase = {
  name: string;
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  body?: Record<string, unknown>;
  expectations: Record<Role, Expectation>;
};

const credentials: Record<Role, RoleCredential> = {
  super_admin: { email: 'superadmin@migunani.com', password: 'superadmin123' },
  admin_gudang: { email: 'gudang@migunani.com', password: 'gudang123' },
  admin_finance: { email: 'finance@migunani.com', password: 'finance123' },
  kasir: { email: 'kasir@migunani.com', password: 'kasir123' },
  driver: { email: 'driver1@migunani.com', password: 'driver123' },
  customer: { email: 'customer1@migunani.com', password: 'customer123' },
};

const forbidden: Expectation = {
  status: 403,
  messageIncludes: 'Access denied'
};

const cases: RegressionCase[] = [
  {
    name: 'finance issue-invoice invalid order',
    method: 'POST',
    path: '/admin/finance/orders/not-real-id/issue-invoice',
    expectations: {
      super_admin: { status: 404 },
      admin_gudang: forbidden,
      admin_finance: forbidden,
      kasir: { status: 404 },
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'finance verify invalid order',
    method: 'PATCH',
    path: '/admin/finance/orders/not-real-id/verify',
    body: { action: 'approve' },
    expectations: {
      super_admin: { status: 404 },
      admin_gudang: forbidden,
      admin_finance: { status: 404 },
      kasir: forbidden,
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'finance verify driver cod invalid payload',
    method: 'POST',
    path: '/admin/finance/driver-cod/verify',
    body: {},
    expectations: {
      super_admin: { status: 400 },
      admin_gudang: forbidden,
      admin_finance: { status: 400 },
      kasir: forbidden,
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'customer otp send invalid whatsapp',
    method: 'POST',
    path: '/admin/customers/otp/send',
    body: { whatsapp_number: '' },
    expectations: {
      super_admin: { status: 400, messageIncludes: 'Nomor WhatsApp tidak valid' },
      admin_gudang: forbidden,
      admin_finance: forbidden,
      kasir: { status: 400, messageIncludes: 'Nomor WhatsApp tidak valid' },
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'customer status update missing customer',
    method: 'PATCH',
    path: '/admin/customers/not-real-id/status',
    body: { status: 'banned' },
    expectations: {
      super_admin: { status: 404, messageIncludes: 'Customer tidak ditemukan' },
      admin_gudang: forbidden,
      admin_finance: forbidden,
      kasir: { status: 404, messageIncludes: 'Customer tidak ditemukan' },
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'shipping method create invalid',
    method: 'POST',
    path: '/admin/shipping-methods',
    body: {},
    expectations: {
      super_admin: { status: 400 },
      admin_gudang: forbidden,
      admin_finance: forbidden,
      kasir: { status: 400 },
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'discount voucher create invalid',
    method: 'POST',
    path: '/admin/discount-vouchers',
    body: {},
    expectations: {
      super_admin: { status: 400 },
      admin_gudang: forbidden,
      admin_finance: forbidden,
      kasir: { status: 400 },
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'staff create invalid',
    method: 'POST',
    path: '/admin/staff',
    body: {},
    expectations: {
      super_admin: { status: 400 },
      admin_gudang: forbidden,
      admin_finance: forbidden,
      kasir: forbidden,
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'inventory po create invalid',
    method: 'POST',
    path: '/admin/inventory/po',
    // Must include at least 1 item to reach supplier_id validation (items length is validated first).
    body: { items: [{ product_id: 'not-real-id', qty: 1 }] },
    expectations: {
      super_admin: { status: 400, messageIncludes: 'supplier_id wajib diisi' },
      admin_gudang: forbidden,
      admin_finance: forbidden,
      kasir: forbidden,
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'inventory supplier create invalid',
    method: 'POST',
    path: '/admin/suppliers',
    body: {},
    expectations: {
      super_admin: { status: 400, messageIncludes: 'Nama supplier wajib diisi' },
      admin_gudang: { status: 400, messageIncludes: 'Nama supplier wajib diisi' },
      admin_finance: forbidden,
      kasir: { status: 400, messageIncludes: 'Nama supplier wajib diisi' },
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'inventory product create invalid',
    method: 'POST',
    path: '/admin/products',
    body: {},
    expectations: {
      super_admin: { status: 400 },
      admin_gudang: { status: 400 },
      admin_finance: forbidden,
      kasir: forbidden,
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'inventory category update invalid id',
    method: 'PUT',
    path: '/admin/categories/not-a-number',
    body: { name: 'Regression' },
    expectations: {
      super_admin: { status: 400, messageIncludes: 'ID kategori tidak valid' },
      admin_gudang: { status: 400, messageIncludes: 'ID kategori tidak valid' },
      admin_finance: forbidden,
      kasir: forbidden,
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'inventory category delete invalid id',
    method: 'DELETE',
    path: '/admin/categories/not-a-number',
    expectations: {
      super_admin: { status: 400, messageIncludes: 'ID kategori tidak valid' },
      admin_gudang: { status: 400, messageIncludes: 'ID kategori tidak valid' },
      admin_finance: forbidden,
      kasir: forbidden,
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'inventory category tier discount invalid payload',
    method: 'PATCH',
    path: '/admin/categories/1/tier-discount',
    body: {},
    expectations: {
      super_admin: { status: 400, messageIncludes: 'wajib dikirim' },
      admin_gudang: forbidden,
      admin_finance: forbidden,
      kasir: { status: 400, messageIncludes: 'wajib dikirim' },
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'inventory supplier update invalid id',
    method: 'PUT',
    path: '/admin/suppliers/not-a-number',
    body: { name: 'Regression' },
    expectations: {
      super_admin: { status: 400, messageIncludes: 'ID supplier tidak valid' },
      admin_gudang: { status: 400, messageIncludes: 'ID supplier tidak valid' },
      admin_finance: forbidden,
      kasir: { status: 400, messageIncludes: 'ID supplier tidak valid' },
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'inventory supplier delete invalid id',
    method: 'DELETE',
    path: '/admin/suppliers/not-a-number',
    expectations: {
      super_admin: { status: 400, messageIncludes: 'ID supplier tidak valid' },
      admin_gudang: { status: 400, messageIncludes: 'ID supplier tidak valid' },
      admin_finance: forbidden,
      kasir: { status: 400, messageIncludes: 'ID supplier tidak valid' },
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'inventory product update missing product',
    method: 'PUT',
    path: '/admin/products/not-real-id',
    body: { name: 'Regression' },
    expectations: {
      super_admin: { status: 404, messageIncludes: 'Product not found' },
      admin_gudang: { status: 404, messageIncludes: 'Product not found' },
      admin_finance: forbidden,
      kasir: forbidden,
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'inventory product tier pricing invalid payload',
    method: 'PATCH',
    path: '/admin/products/1/tier-pricing',
    body: {},
    expectations: {
      super_admin: { status: 400, messageIncludes: 'wajib berupa angka valid' },
      admin_gudang: forbidden,
      admin_finance: forbidden,
      kasir: { status: 400, messageIncludes: 'wajib berupa angka valid' },
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'inventory stock mutation invalid product',
    method: 'POST',
    path: '/admin/inventory/mutation',
    body: { product_id: 'not-real-id', type: 'in', qty: 1, note: 'regression' },
    expectations: {
      super_admin: { status: 404, messageIncludes: 'Product not found' },
      admin_gudang: { status: 404, messageIncludes: 'Product not found' },
      admin_finance: forbidden,
      kasir: forbidden,
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'inventory po receive invalid id',
    method: 'PATCH',
    path: '/admin/inventory/po/not-real-id/receive',
    body: { items: [] },
    expectations: {
      super_admin: { status: 404, messageIncludes: 'Purchase Order not found' },
      admin_gudang: forbidden,
      admin_finance: forbidden,
      kasir: forbidden,
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'inventory import commit empty rows',
    method: 'POST',
    path: '/admin/inventory/import/commit',
    body: {},
    expectations: {
      super_admin: { status: 400, messageIncludes: 'rows wajib diisi' },
      admin_gudang: { status: 400, messageIncludes: 'rows wajib diisi' },
      admin_finance: forbidden,
      kasir: forbidden,
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'stock opname submit invalid opname',
    method: 'POST',
    path: '/inventory/audit/not-real-id/item',
    body: { product_id: 'not-real-id', physical_qty: 1 },
    expectations: {
      super_admin: { status: 400, messageIncludes: 'Opname not found or not open' },
      admin_gudang: { status: 400, messageIncludes: 'Opname not found or not open' },
      admin_finance: forbidden,
      kasir: forbidden,
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'stock opname finish invalid opname',
    method: 'POST',
    path: '/inventory/audit/not-real-id/finish',
    body: {},
    expectations: {
      super_admin: { status: 400, messageIncludes: 'Opname not found or not open' },
      admin_gudang: { status: 400, messageIncludes: 'Opname not found or not open' },
      admin_finance: forbidden,
      kasir: forbidden,
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'shipping method update missing code',
    method: 'PATCH',
    path: '/admin/shipping-methods/not-real-code',
    body: { name: 'Regression' },
    expectations: {
      super_admin: { status: 404, messageIncludes: 'Metode pengiriman tidak ditemukan.' },
      admin_gudang: forbidden,
      admin_finance: forbidden,
      kasir: { status: 404, messageIncludes: 'Metode pengiriman tidak ditemukan.' },
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'shipping method delete missing code',
    method: 'DELETE',
    path: '/admin/shipping-methods/not-real-code',
    expectations: {
      super_admin: { status: 404, messageIncludes: 'Metode pengiriman tidak ditemukan.' },
      admin_gudang: forbidden,
      admin_finance: forbidden,
      kasir: { status: 404, messageIncludes: 'Metode pengiriman tidak ditemukan.' },
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'discount voucher update missing code',
    method: 'PATCH',
    path: '/admin/discount-vouchers/not-real-code',
    body: { is_active: false },
    expectations: {
      super_admin: { status: 404, messageIncludes: 'Voucher diskon tidak ditemukan.' },
      admin_gudang: forbidden,
      admin_finance: forbidden,
      kasir: { status: 404, messageIncludes: 'Voucher diskon tidak ditemukan.' },
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'discount voucher delete missing code',
    method: 'DELETE',
    path: '/admin/discount-vouchers/not-real-code',
    expectations: {
      super_admin: { status: 404, messageIncludes: 'Voucher diskon tidak ditemukan.' },
      admin_gudang: forbidden,
      admin_finance: forbidden,
      kasir: { status: 404, messageIncludes: 'Voucher diskon tidak ditemukan.' },
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'staff update missing staff',
    method: 'PATCH',
    path: '/admin/staff/not-real-id',
    body: { name: 'Regression' },
    expectations: {
      super_admin: { status: 404, messageIncludes: 'Staf tidak ditemukan' },
      admin_gudang: forbidden,
      admin_finance: forbidden,
      kasir: forbidden,
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'staff delete missing staff',
    method: 'DELETE',
    path: '/admin/staff/not-real-id',
    expectations: {
      super_admin: { status: 404, messageIncludes: 'Staf tidak ditemukan' },
      admin_gudang: forbidden,
      admin_finance: forbidden,
      kasir: forbidden,
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'account create invalid payload',
    method: 'POST',
    path: '/admin/accounts',
    body: {},
    expectations: {
      super_admin: { status: 400, messageIncludes: 'code wajib diisi' },
      admin_gudang: forbidden,
      admin_finance: { status: 400, messageIncludes: 'code wajib diisi' },
      kasir: forbidden,
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'account update invalid id',
    method: 'PUT',
    path: '/admin/accounts/not-a-number',
    body: { name: 'Regression Account' },
    expectations: {
      super_admin: { status: 400, messageIncludes: 'ID account tidak valid' },
      admin_gudang: forbidden,
      admin_finance: { status: 400, messageIncludes: 'ID account tidak valid' },
      kasir: forbidden,
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'account delete invalid id',
    method: 'DELETE',
    path: '/admin/accounts/not-a-number',
    expectations: {
      super_admin: { status: 400, messageIncludes: 'ID account tidak valid' },
      admin_gudang: forbidden,
      admin_finance: { status: 400, messageIncludes: 'ID account tidak valid' },
      kasir: forbidden,
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'allocation allocate invalid order',
    method: 'POST',
    path: '/allocation/not-real-id',
    body: { items: [{ product_id: 'not-real-id', qty: 1 }] },
    expectations: {
      super_admin: { status: 404, messageIncludes: 'Order not found' },
      admin_gudang: { status: 404, messageIncludes: 'Order not found' },
      admin_finance: forbidden,
      kasir: { status: 404, messageIncludes: 'Order not found' },
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'allocation cancel backorder invalid order',
    method: 'POST',
    path: '/allocation/not-real-id/cancel-backorder',
    body: { reason: 'regression' },
    expectations: {
      super_admin: { status: 404, messageIncludes: 'Order tidak ditemukan' },
      admin_gudang: { status: 404, messageIncludes: 'Order tidak ditemukan' },
      admin_finance: forbidden,
      kasir: { status: 404, messageIncludes: 'Order tidak ditemukan' },
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'customer create invalid payload',
    method: 'POST',
    path: '/admin/customers/create',
    body: {},
    expectations: {
      super_admin: { status: 400, messageIncludes: 'Nama customer wajib diisi' },
      admin_gudang: forbidden,
      admin_finance: forbidden,
      kasir: { status: 400, messageIncludes: 'Nama customer wajib diisi' },
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'customer tier update invalid payload',
    method: 'PATCH',
    path: '/admin/customers/99999999/tier',
    body: { tier: 'bronze' },
    expectations: {
      super_admin: { status: 400, messageIncludes: 'Tier tidak valid' },
      admin_gudang: forbidden,
      admin_finance: forbidden,
      kasir: { status: 400, messageIncludes: 'Tier tidak valid' },
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'inventory import preview missing file',
    method: 'POST',
    path: '/admin/inventory/import/preview',
    body: {},
    expectations: {
      super_admin: { status: 400, messageIncludes: 'File wajib diunggah' },
      admin_gudang: { status: 400, messageIncludes: 'File wajib diunggah' },
      admin_finance: forbidden,
      kasir: forbidden,
      driver: forbidden,
      customer: forbidden,
    }
  },
  {
    name: 'inventory import-from-path disabled',
    method: 'POST',
    path: '/admin/inventory/import-from-path',
    body: { file_path: '/tmp/not-used.xlsx' },
    expectations: {
      super_admin: { status: 403, messageIncludes: 'Import local path tidak diaktifkan' },
      admin_gudang: forbidden,
      admin_finance: forbidden,
      kasir: forbidden,
      driver: forbidden,
      customer: forbidden,
    }
  }
];

async function login(role: Role): Promise<string> {
  const creds = credentials[role];
  const response = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(creds)
  });
  const data = await response.json();
  if (!response.ok || typeof data?.token !== 'string') {
    throw new Error(`Login failed for ${role}: ${response.status} ${JSON.stringify(data)}`);
  }
  return data.token;
}

async function invoke(token: string, testCase: RegressionCase) {
  const response = await fetch(`${BASE_URL}${testCase.path}`, {
    method: testCase.method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: testCase.body === undefined ? undefined : JSON.stringify(testCase.body)
  });

  const bodyText = await response.text();
  return {
    status: response.status,
    bodyText
  };
}

async function getFirstCategoryId(token: string): Promise<number | null> {
  const response = await fetch(`${BASE_URL}/admin/categories`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
  });
  const text = await response.text();
  if (!response.ok) return null;
  try {
    const parsed = text ? JSON.parse(text) : null;
    const rows = Array.isArray(parsed?.categories) ? parsed.categories : [];
    const id = Number(rows[0]?.id);
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

function assertExpectation(role: Role, testCase: RegressionCase, actual: { status: number; bodyText: string }) {
  const expected = testCase.expectations[role];
  if (actual.status !== expected.status) {
    throw new Error(
      `[${testCase.name}] ${role} expected ${expected.status} but received ${actual.status}. Body: ${actual.bodyText}`
    );
  }

  if (expected.messageIncludes && !actual.bodyText.includes(expected.messageIncludes)) {
    throw new Error(
      `[${testCase.name}] ${role} body did not include "${expected.messageIncludes}". Body: ${actual.bodyText}`
    );
  }
}

async function main() {
  const tokens = {} as Record<Role, string>;
  for (const role of Object.keys(credentials) as Role[]) {
    tokens[role] = await login(role);
  }

  const seedCategoryId = await getFirstCategoryId(tokens.super_admin);
  if (!seedCategoryId) {
    throw new Error('No seeded category found for action matrix (cannot run tier-discount payload regression).');
  }

  let passed = 0;
  for (const testCase of cases) {
    const effectiveCase: RegressionCase = testCase.name === 'inventory category tier discount invalid payload'
      ? { ...testCase, path: `/admin/categories/${seedCategoryId}/tier-discount` }
      : testCase;

    console.log(`\n## ${effectiveCase.name}`);
    for (const role of Object.keys(credentials) as Role[]) {
      const actual = await invoke(tokens[role], effectiveCase);
      assertExpectation(role, effectiveCase, actual);
      console.log(`PASS ${role.padEnd(14)} -> ${actual.status}`);
      passed += 1;
    }
  }

  console.log(`\nRegression action matrix passed: ${passed} checks`);
}

main().catch((error) => {
  console.error('\nRegression action matrix failed');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
