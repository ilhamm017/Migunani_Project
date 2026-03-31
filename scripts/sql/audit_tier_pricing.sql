-- Audit: Tier Pricing vs Category Discount
-- Usage example:
--   mysql -h 127.0.0.1 -u migunani -ppassword -D migunani_motor_db < scripts/sql/audit_tier_pricing.sql

SELECT 'products_with_varian_harga' AS metric, COUNT(*) AS value
FROM products
WHERE status='active' AND varian_harga IS NOT NULL;

-- Tier price placeholders: gold == regular inside varian_harga
SELECT 'placeholder_gold_equals_regular' AS metric, COUNT(*) AS value
FROM products
WHERE status='active'
  AND varian_harga IS NOT NULL
  AND JSON_EXTRACT(varian_harga,'$.prices.gold') IS NOT NULL
  AND JSON_EXTRACT(varian_harga,'$.prices.regular') IS NOT NULL
  AND JSON_EXTRACT(varian_harga,'$.prices.gold') = JSON_EXTRACT(varian_harga,'$.prices.regular');

-- Mismatch between products.price and varian_harga regular (often indicates price updated but varian_harga not refreshed)
SELECT 'mismatch_products_price_vs_variant_regular' AS metric, COUNT(*) AS value
FROM products
WHERE status='active'
  AND varian_harga IS NOT NULL
  AND JSON_EXTRACT(varian_harga,'$.prices.regular') IS NOT NULL
  AND CAST(JSON_EXTRACT(varian_harga,'$.prices.regular') AS DECIMAL(15,2)) > 0
  AND price > 0
  AND CAST(price AS DECIMAL(15,2)) <> CAST(JSON_EXTRACT(varian_harga,'$.prices.regular') AS DECIMAL(15,2));

-- Sample top mismatches by absolute difference
SELECT
  p.id,
  p.sku,
  p.name,
  p.category_id,
  CAST(p.price AS DECIMAL(15,2)) AS product_price,
  CAST(JSON_EXTRACT(p.varian_harga,'$.prices.regular') AS DECIMAL(15,2)) AS variant_regular_price,
  ABS(CAST(p.price AS DECIMAL(15,2)) - CAST(JSON_EXTRACT(p.varian_harga,'$.prices.regular') AS DECIMAL(15,2))) AS abs_diff
FROM products p
WHERE p.status='active'
  AND p.varian_harga IS NOT NULL
  AND JSON_EXTRACT(p.varian_harga,'$.prices.regular') IS NOT NULL
  AND CAST(JSON_EXTRACT(p.varian_harga,'$.prices.regular') AS DECIMAL(15,2)) > 0
  AND p.price > 0
  AND CAST(p.price AS DECIMAL(15,2)) <> CAST(JSON_EXTRACT(p.varian_harga,'$.prices.regular') AS DECIMAL(15,2))
ORDER BY abs_diff DESC
LIMIT 50;

-- Categories with tier discount configured (non-null / >0)
SELECT
  id,
  name,
  discount_regular_pct,
  discount_gold_pct,
  discount_premium_pct
FROM categories
WHERE (discount_regular_pct IS NOT NULL AND discount_regular_pct > 0)
   OR (discount_gold_pct IS NOT NULL AND discount_gold_pct > 0)
   OR (discount_premium_pct IS NOT NULL AND discount_premium_pct > 0)
ORDER BY id ASC;

