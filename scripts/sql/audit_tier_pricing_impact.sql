-- Audit: Impact estimation for "placeholder tier price blocks category discount"
--
-- Background:
-- Some products store tier prices in `products.varian_harga.prices.<tier>` but keep them equal to
-- `prices.regular` (placeholders). If `products.price` changes later (e.g., inventory import updates
-- price but not varian_harga), older pricing resolvers may incorrectly treat the placeholder tier
-- price as a real override and skip category-tier discounts.
--
-- Usage example:
--   mysql -h 127.0.0.1 -u migunani -ppassword -D migunani_motor_db < scripts/sql/audit_tier_pricing_impact.sql

-- How many active products have varian_harga?
SELECT 'products_with_varian_harga' AS metric, COUNT(*) AS value
FROM products
WHERE status='active' AND varian_harga IS NOT NULL;

-- Intersection: placeholder gold == regular AND products.price differs from variant regular AND category has gold discount.
SELECT 'impact_gold_placeholder_and_mismatch_and_category_discount' AS metric, COUNT(*) AS value
FROM products p
JOIN categories c ON c.id = p.category_id
WHERE p.status='active'
  AND p.varian_harga IS NOT NULL
  AND JSON_EXTRACT(p.varian_harga,'$.prices.gold') IS NOT NULL
  AND JSON_EXTRACT(p.varian_harga,'$.prices.regular') IS NOT NULL
  AND JSON_EXTRACT(p.varian_harga,'$.prices.gold') = JSON_EXTRACT(p.varian_harga,'$.prices.regular')
  AND p.price > 0
  AND CAST(p.price AS DECIMAL(15,2)) <> CAST(JSON_EXTRACT(p.varian_harga,'$.prices.regular') AS DECIMAL(15,2))
  AND c.discount_gold_pct IS NOT NULL
  AND c.discount_gold_pct > 0;

-- Intersection: placeholder platinum == regular AND products.price differs from variant regular AND category has premium/platinum discount.
SELECT 'impact_platinum_placeholder_and_mismatch_and_category_discount' AS metric, COUNT(*) AS value
FROM products p
JOIN categories c ON c.id = p.category_id
WHERE p.status='active'
  AND p.varian_harga IS NOT NULL
  AND JSON_EXTRACT(p.varian_harga,'$.prices.platinum') IS NOT NULL
  AND JSON_EXTRACT(p.varian_harga,'$.prices.regular') IS NOT NULL
  AND JSON_EXTRACT(p.varian_harga,'$.prices.platinum') = JSON_EXTRACT(p.varian_harga,'$.prices.regular')
  AND p.price > 0
  AND CAST(p.price AS DECIMAL(15,2)) <> CAST(JSON_EXTRACT(p.varian_harga,'$.prices.regular') AS DECIMAL(15,2))
  AND c.discount_premium_pct IS NOT NULL
  AND c.discount_premium_pct > 0;

-- Top examples (gold): largest per-unit overcharge IF the buggy behavior was applied.
-- Notes:
-- - This estimates impact for the specific placeholder pattern.
-- - "implied_bug_discount_pct" approximates what the UI would show if it did (product.price - placeholderTierPrice)/product.price.
SELECT
  p.id,
  p.sku,
  p.name,
  p.category_id,
  c.name AS category_name,
  CAST(p.price AS DECIMAL(15,2)) AS product_price,
  CAST(JSON_EXTRACT(p.varian_harga,'$.prices.regular') AS DECIMAL(15,2)) AS variant_regular_price,
  CAST(JSON_EXTRACT(p.varian_harga,'$.prices.gold') AS DECIMAL(15,2)) AS placeholder_gold_price,
  CAST(c.discount_gold_pct AS DECIMAL(10,3)) AS category_gold_discount_pct,
  ROUND(((CAST(p.price AS DECIMAL(15,2)) - CAST(JSON_EXTRACT(p.varian_harga,'$.prices.gold') AS DECIMAL(15,2))) / CAST(p.price AS DECIMAL(15,2))) * 100, 2) AS implied_bug_discount_pct,
  ROUND(CAST(p.price AS DECIMAL(15,2)) * (1 - (CAST(c.discount_gold_pct AS DECIMAL(10,3)) / 100)), 2) AS expected_gold_price_by_category,
  ROUND(CAST(JSON_EXTRACT(p.varian_harga,'$.prices.gold') AS DECIMAL(15,2)) - (CAST(p.price AS DECIMAL(15,2)) * (1 - (CAST(c.discount_gold_pct AS DECIMAL(10,3)) / 100))), 2) AS overcharge_per_unit_if_bug
FROM products p
JOIN categories c ON c.id = p.category_id
WHERE p.status='active'
  AND p.varian_harga IS NOT NULL
  AND JSON_EXTRACT(p.varian_harga,'$.prices.gold') IS NOT NULL
  AND JSON_EXTRACT(p.varian_harga,'$.prices.regular') IS NOT NULL
  AND JSON_EXTRACT(p.varian_harga,'$.prices.gold') = JSON_EXTRACT(p.varian_harga,'$.prices.regular')
  AND p.price > 0
  AND CAST(p.price AS DECIMAL(15,2)) <> CAST(JSON_EXTRACT(p.varian_harga,'$.prices.regular') AS DECIMAL(15,2))
  AND c.discount_gold_pct IS NOT NULL
  AND c.discount_gold_pct > 0
ORDER BY overcharge_per_unit_if_bug DESC
LIMIT 50;

-- Top examples (platinum): largest per-unit overcharge IF the buggy behavior was applied.
SELECT
  p.id,
  p.sku,
  p.name,
  p.category_id,
  c.name AS category_name,
  CAST(p.price AS DECIMAL(15,2)) AS product_price,
  CAST(JSON_EXTRACT(p.varian_harga,'$.prices.regular') AS DECIMAL(15,2)) AS variant_regular_price,
  CAST(JSON_EXTRACT(p.varian_harga,'$.prices.platinum') AS DECIMAL(15,2)) AS placeholder_platinum_price,
  CAST(c.discount_premium_pct AS DECIMAL(10,3)) AS category_platinum_discount_pct,
  ROUND(((CAST(p.price AS DECIMAL(15,2)) - CAST(JSON_EXTRACT(p.varian_harga,'$.prices.platinum') AS DECIMAL(15,2))) / CAST(p.price AS DECIMAL(15,2))) * 100, 2) AS implied_bug_discount_pct,
  ROUND(CAST(p.price AS DECIMAL(15,2)) * (1 - (CAST(c.discount_premium_pct AS DECIMAL(10,3)) / 100)), 2) AS expected_platinum_price_by_category,
  ROUND(CAST(JSON_EXTRACT(p.varian_harga,'$.prices.platinum') AS DECIMAL(15,2)) - (CAST(p.price AS DECIMAL(15,2)) * (1 - (CAST(c.discount_premium_pct AS DECIMAL(10,3)) / 100))), 2) AS overcharge_per_unit_if_bug
FROM products p
JOIN categories c ON c.id = p.category_id
WHERE p.status='active'
  AND p.varian_harga IS NOT NULL
  AND JSON_EXTRACT(p.varian_harga,'$.prices.platinum') IS NOT NULL
  AND JSON_EXTRACT(p.varian_harga,'$.prices.regular') IS NOT NULL
  AND JSON_EXTRACT(p.varian_harga,'$.prices.platinum') = JSON_EXTRACT(p.varian_harga,'$.prices.regular')
  AND p.price > 0
  AND CAST(p.price AS DECIMAL(15,2)) <> CAST(JSON_EXTRACT(p.varian_harga,'$.prices.regular') AS DECIMAL(15,2))
  AND c.discount_premium_pct IS NOT NULL
  AND c.discount_premium_pct > 0
ORDER BY overcharge_per_unit_if_bug DESC
LIMIT 50;

