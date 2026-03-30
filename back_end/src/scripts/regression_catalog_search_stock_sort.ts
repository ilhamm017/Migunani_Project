const BASE_URL = String(process.env.API_BASE_URL || 'http://127.0.0.1:5000/api/v1').replace(/\/$/, '');

export {};

async function requestJson(path: string) {
  const response = await fetch(`${BASE_URL}${path}`, { method: 'GET' });
  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: response.ok, status: response.status, data };
}

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

async function main() {
  const res = await requestJson('/catalog?search=oli&sort=stock_desc&page=1&limit=5');
  assert(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
  assert(res.ok, `request not ok: ${res.status}`);

  const products = Array.isArray(res.data?.products) ? res.data.products : null;
  assert(products, `expected products array, got: ${JSON.stringify(res.data)}`);

  for (const product of products) {
    assert(product && typeof product === 'object', `invalid product row: ${JSON.stringify(product)}`);
    assert(!('stock_quantity' in product), `public catalog leaked stock_quantity: ${JSON.stringify(product)}`);
  }

  console.log(`PASS catalog search stock sort -> ${products.length} products`);
}

main().catch((error) => {
  console.error('\\nCatalog stock sort regression failed');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
