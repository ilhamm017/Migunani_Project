const BASE_URL = String(process.env.API_BASE_URL || 'http://127.0.0.1:5000/api/v1').replace(/\/$/, '');

export {};

type Role = 'super_admin' | 'admin_finance' | 'admin_gudang' | 'kasir' | 'driver' | 'customer';

const credentials: Record<Role, { email: string; password: string }> = {
  super_admin: { email: 'superadmin@migunani.com', password: 'superadmin123' },
  admin_finance: { email: 'finance@migunani.com', password: 'finance123' },
  admin_gudang: { email: 'gudang@migunani.com', password: 'gudang123' },
  kasir: { email: 'kasir@migunani.com', password: 'kasir123' },
  driver: { email: 'driver1@migunani.com', password: 'driver123' },
  customer: { email: 'customer1@migunani.com', password: 'customer123' },
};

async function login(role: Role) {
  const response = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials[role])
  });
  const data = await response.json();
  if (!response.ok || typeof data?.token !== 'string') {
    throw new Error(`Login failed for ${role}: ${response.status} ${JSON.stringify(data)}`);
  }
  return String(data.token);
}

async function requestJson(token: string | null, path: string) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

function assertStatus(actual: number, expected: number, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

async function main() {
  const superAdminToken = await login('super_admin');
  const adminFinanceToken = await login('admin_finance');
  const kasirToken = await login('kasir');
  const driverToken = await login('driver');
  const customerToken = await login('customer');

  const catalogInvalidCategory = await requestJson(null, '/catalog?category_id=abc');
  assertStatus(catalogInvalidCategory.status, 400, 'catalog invalid category');
  console.log(`PASS catalog invalid category -> ${catalogInvalidCategory.status}`);

  const catalogMissingProduct = await requestJson(null, '/catalog/not-real-product');
  assertStatus(catalogMissingProduct.status, 404, 'catalog missing product');
  console.log(`PASS catalog missing product -> ${catalogMissingProduct.status}`);

  const customerSearchInvalidStatus = await requestJson(kasirToken, '/admin/customers/search?status=%%%');
  assertStatus(customerSearchInvalidStatus.status, 200, 'customer search invalid status fallback');
  console.log(`PASS customer search invalid status fallback -> ${customerSearchInvalidStatus.status}`);

  const customerDetailInvalidId = await requestJson(superAdminToken, '/admin/customers/not-a-valid-id');
  assertStatus(customerDetailInvalidId.status, 404, 'customer detail invalid id');
  console.log(`PASS customer detail invalid id -> ${customerDetailInvalidId.status}`);

  const customerOrdersInvalidId = await requestJson(superAdminToken, '/admin/customers/not-a-valid-id/orders');
  assertStatus(customerOrdersInvalidId.status, 404, 'customer orders invalid id');
  console.log(`PASS customer orders invalid id -> ${customerOrdersInvalidId.status}`);

  const driverOrdersInvalidDate = await requestJson(driverToken, '/driver/orders?startDate=not-a-date');
  assertStatus(driverOrdersInvalidDate.status, 200, 'driver orders invalid date fallback');
  console.log(`PASS driver orders invalid date fallback -> ${driverOrdersInvalidDate.status}`);

  const driverWalletFinance = await requestJson(adminFinanceToken, '/driver/wallet');
  assertStatus(driverWalletFinance.status, 200, 'driver wallet finance access');
  console.log(`PASS driver wallet finance access -> ${driverWalletFinance.status}`);

  const driverWalletCustomer = await requestJson(customerToken, '/driver/wallet');
  assertStatus(driverWalletCustomer.status, 403, 'driver wallet customer forbidden');
  console.log(`PASS driver wallet customer forbidden -> ${driverWalletCustomer.status}`);
}

main().catch((error) => {
  console.error('\nBoundary read regression failed');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
