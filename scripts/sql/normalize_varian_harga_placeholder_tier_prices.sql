-- Normalize placeholder tier prices in `products.varian_harga`
--
-- Problem pattern:
--   varian_harga.prices.gold/platinum/premium are present but equal to prices.regular (placeholders).
--   Old pricing resolvers may treat these as real tier overrides and block category-tier discounts.
--
-- This script removes tier price keys that just duplicate regular, leaving the regular price intact.
--
-- Safety:
-- - Recommended: run a DB backup before executing.
-- - This does NOT change `products.price`.
--
-- Usage:
--   mysql -h 127.0.0.1 -u migunani -ppassword -D migunani_motor_db < scripts/sql/normalize_varian_harga_placeholder_tier_prices.sql

-- Preview counts
SELECT 'will_remove_prices_gold' AS metric, COUNT(*) AS rows_affected
FROM products
WHERE status='active'
  AND varian_harga IS NOT NULL
  AND JSON_EXTRACT(varian_harga,'$.prices.gold') IS NOT NULL
  AND JSON_EXTRACT(varian_harga,'$.prices.regular') IS NOT NULL
  AND JSON_EXTRACT(varian_harga,'$.prices.gold') = JSON_EXTRACT(varian_harga,'$.prices.regular');

SELECT 'will_remove_prices_platinum' AS metric, COUNT(*) AS rows_affected
FROM products
WHERE status='active'
  AND varian_harga IS NOT NULL
  AND JSON_EXTRACT(varian_harga,'$.prices.platinum') IS NOT NULL
  AND JSON_EXTRACT(varian_harga,'$.prices.regular') IS NOT NULL
  AND JSON_EXTRACT(varian_harga,'$.prices.platinum') = JSON_EXTRACT(varian_harga,'$.prices.regular');

SELECT 'will_remove_prices_premium' AS metric, COUNT(*) AS rows_affected
FROM products
WHERE status='active'
  AND varian_harga IS NOT NULL
  AND JSON_EXTRACT(varian_harga,'$.prices.premium') IS NOT NULL
  AND JSON_EXTRACT(varian_harga,'$.prices.regular') IS NOT NULL
  AND JSON_EXTRACT(varian_harga,'$.prices.premium') = JSON_EXTRACT(varian_harga,'$.prices.regular');

-- Apply normalization (idempotent)
UPDATE products
SET varian_harga = JSON_REMOVE(varian_harga, '$.prices.gold', '$.gold')
WHERE status='active'
  AND varian_harga IS NOT NULL
  AND JSON_EXTRACT(varian_harga,'$.prices.gold') IS NOT NULL
  AND JSON_EXTRACT(varian_harga,'$.prices.regular') IS NOT NULL
  AND JSON_EXTRACT(varian_harga,'$.prices.gold') = JSON_EXTRACT(varian_harga,'$.prices.regular');

UPDATE products
SET varian_harga = JSON_REMOVE(varian_harga, '$.prices.platinum', '$.platinum')
WHERE status='active'
  AND varian_harga IS NOT NULL
  AND JSON_EXTRACT(varian_harga,'$.prices.platinum') IS NOT NULL
  AND JSON_EXTRACT(varian_harga,'$.prices.regular') IS NOT NULL
  AND JSON_EXTRACT(varian_harga,'$.prices.platinum') = JSON_EXTRACT(varian_harga,'$.prices.regular');

UPDATE products
SET varian_harga = JSON_REMOVE(varian_harga, '$.prices.premium', '$.premium')
WHERE status='active'
  AND varian_harga IS NOT NULL
  AND JSON_EXTRACT(varian_harga,'$.prices.premium') IS NOT NULL
  AND JSON_EXTRACT(varian_harga,'$.prices.regular') IS NOT NULL
  AND JSON_EXTRACT(varian_harga,'$.prices.premium') = JSON_EXTRACT(varian_harga,'$.prices.regular');

