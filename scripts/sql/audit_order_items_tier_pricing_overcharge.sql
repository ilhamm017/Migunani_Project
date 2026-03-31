-- Audit (Heuristic): Order items potentially overcharged because category-tier discount was blocked by tier-pricing data.
--
-- Why "heuristic"?
-- The system supports several discount sources:
-- - Direct tier prices in `products.varian_harga` (per-item overrides)
-- - Variant-level tier discounts (`varian_harga.discounts_pct`)
-- - Category-tier discounts (`categories.discount_*_pct`)
-- This audit flags cases where `pricing_snapshot` indicates a tier fallback was used even though
-- the category has a configured tier discount that would have produced a lower unit price.
--
-- IMPORTANT:
-- - This does not prove mispricing; it produces a shortlist for manual verification.
-- - If a product intentionally has a per-item tier override, those rows may appear here.
--
-- Usage example:
--   mysql -h 127.0.0.1 -u migunani -ppassword -D migunani_motor_db < scripts/sql/audit_order_items_tier_pricing_overcharge.sql

-- Adjust timeframe if needed (recommended):
--   AND o.createdAt >= '2026-03-01'
--   AND o.createdAt <  '2026-04-01'

-- 1) Summary (by tier)
SELECT
  JSON_UNQUOTE(JSON_EXTRACT(oi.pricing_snapshot,'$.tier')) AS customer_tier,
  COUNT(*) AS item_rows,
  COUNT(DISTINCT o.id) AS orders_count,
  ROUND(SUM(
    GREATEST(
      0,
      (
        CAST(JSON_UNQUOTE(JSON_EXTRACT(oi.pricing_snapshot,'$.computed_unit_price')) AS DECIMAL(15,2))
        - ROUND(
            CAST(JSON_UNQUOTE(JSON_EXTRACT(oi.pricing_snapshot,'$.base_price')) AS DECIMAL(15,2))
            * (1 - (
              CASE JSON_UNQUOTE(JSON_EXTRACT(oi.pricing_snapshot,'$.tier'))
                WHEN 'gold' THEN CAST(c.discount_gold_pct AS DECIMAL(10,3))
                WHEN 'platinum' THEN CAST(c.discount_premium_pct AS DECIMAL(10,3))
                ELSE 0
              END
            ) / 100),
          2
        )
      )
      * CAST(oi.qty AS DECIMAL(15,2))
    )
  ), 2) AS est_overcharge_total
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
LEFT JOIN users u ON u.id = o.customer_id
LEFT JOIN categories c ON c.id = CAST(JSON_UNQUOTE(JSON_EXTRACT(oi.pricing_snapshot,'$.category_id')) AS UNSIGNED)
WHERE oi.clearance_promo_id IS NULL
  AND oi.pricing_snapshot IS NOT NULL
  AND o.status NOT IN ('canceled', 'expired')
  AND JSON_UNQUOTE(JSON_EXTRACT(oi.pricing_snapshot,'$.tier')) IN ('gold', 'platinum')
  AND JSON_UNQUOTE(JSON_EXTRACT(oi.pricing_snapshot,'$.discount_source')) = 'tier_fallback'
  AND JSON_EXTRACT(oi.pricing_snapshot,'$.override') IS NULL
  AND (
    (JSON_UNQUOTE(JSON_EXTRACT(oi.pricing_snapshot,'$.tier')) = 'gold' AND c.discount_gold_pct IS NOT NULL AND c.discount_gold_pct > 0)
    OR
    (JSON_UNQUOTE(JSON_EXTRACT(oi.pricing_snapshot,'$.tier')) = 'platinum' AND c.discount_premium_pct IS NOT NULL AND c.discount_premium_pct > 0)
  )
GROUP BY customer_tier
ORDER BY est_overcharge_total DESC;

-- 2) Detail: top rows by estimated overcharge (per line)
SELECT
  o.id AS order_id,
  o.createdAt AS order_created_at,
  o.status AS order_status,
  o.customer_id,
  u.email AS customer_email,
  oi.id AS order_item_id,
  oi.product_id,
  oi.qty,
  JSON_UNQUOTE(JSON_EXTRACT(oi.pricing_snapshot,'$.tier')) AS customer_tier,
  JSON_UNQUOTE(JSON_EXTRACT(oi.pricing_snapshot,'$.discount_source')) AS discount_source,
  CAST(JSON_UNQUOTE(JSON_EXTRACT(oi.pricing_snapshot,'$.base_price')) AS DECIMAL(15,2)) AS base_price_snapshot,
  CAST(JSON_UNQUOTE(JSON_EXTRACT(oi.pricing_snapshot,'$.computed_unit_price')) AS DECIMAL(15,2)) AS computed_unit_price_snapshot,
  CAST(JSON_UNQUOTE(JSON_EXTRACT(oi.pricing_snapshot,'$.final_unit_price')) AS DECIMAL(15,2)) AS final_unit_price_snapshot,
  c.id AS category_id,
  c.name AS category_name,
  CASE JSON_UNQUOTE(JSON_EXTRACT(oi.pricing_snapshot,'$.tier'))
    WHEN 'gold' THEN CAST(c.discount_gold_pct AS DECIMAL(10,3))
    WHEN 'platinum' THEN CAST(c.discount_premium_pct AS DECIMAL(10,3))
    ELSE NULL
  END AS category_discount_pct,
  ROUND(
    CAST(JSON_UNQUOTE(JSON_EXTRACT(oi.pricing_snapshot,'$.base_price')) AS DECIMAL(15,2))
    * (1 - (
      CASE JSON_UNQUOTE(JSON_EXTRACT(oi.pricing_snapshot,'$.tier'))
        WHEN 'gold' THEN CAST(c.discount_gold_pct AS DECIMAL(10,3))
        WHEN 'platinum' THEN CAST(c.discount_premium_pct AS DECIMAL(10,3))
        ELSE 0
      END
    ) / 100),
    2
  ) AS expected_category_unit_price,
  ROUND(
    CAST(JSON_UNQUOTE(JSON_EXTRACT(oi.pricing_snapshot,'$.computed_unit_price')) AS DECIMAL(15,2))
    - (
      CAST(JSON_UNQUOTE(JSON_EXTRACT(oi.pricing_snapshot,'$.base_price')) AS DECIMAL(15,2))
      * (1 - (
        CASE JSON_UNQUOTE(JSON_EXTRACT(oi.pricing_snapshot,'$.tier'))
          WHEN 'gold' THEN CAST(c.discount_gold_pct AS DECIMAL(10,3))
          WHEN 'platinum' THEN CAST(c.discount_premium_pct AS DECIMAL(10,3))
          ELSE 0
        END
      ) / 100)
    ),
    2
  ) AS est_overcharge_per_unit,
  ROUND(
    GREATEST(
      0,
      (
        CAST(JSON_UNQUOTE(JSON_EXTRACT(oi.pricing_snapshot,'$.computed_unit_price')) AS DECIMAL(15,2))
        - (
          CAST(JSON_UNQUOTE(JSON_EXTRACT(oi.pricing_snapshot,'$.base_price')) AS DECIMAL(15,2))
          * (1 - (
            CASE JSON_UNQUOTE(JSON_EXTRACT(oi.pricing_snapshot,'$.tier'))
              WHEN 'gold' THEN CAST(c.discount_gold_pct AS DECIMAL(10,3))
              WHEN 'platinum' THEN CAST(c.discount_premium_pct AS DECIMAL(10,3))
              ELSE 0
            END
          ) / 100)
        )
      )
      * CAST(oi.qty AS DECIMAL(15,2))
    ),
    2
  ) AS est_overcharge_line_total
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
LEFT JOIN users u ON u.id = o.customer_id
LEFT JOIN categories c ON c.id = CAST(JSON_UNQUOTE(JSON_EXTRACT(oi.pricing_snapshot,'$.category_id')) AS UNSIGNED)
WHERE oi.clearance_promo_id IS NULL
  AND oi.pricing_snapshot IS NOT NULL
  AND o.status NOT IN ('canceled', 'expired')
  AND JSON_UNQUOTE(JSON_EXTRACT(oi.pricing_snapshot,'$.tier')) IN ('gold', 'platinum')
  AND JSON_UNQUOTE(JSON_EXTRACT(oi.pricing_snapshot,'$.discount_source')) = 'tier_fallback'
  AND JSON_EXTRACT(oi.pricing_snapshot,'$.override') IS NULL
  AND (
    (JSON_UNQUOTE(JSON_EXTRACT(oi.pricing_snapshot,'$.tier')) = 'gold' AND c.discount_gold_pct IS NOT NULL AND c.discount_gold_pct > 0)
    OR
    (JSON_UNQUOTE(JSON_EXTRACT(oi.pricing_snapshot,'$.tier')) = 'platinum' AND c.discount_premium_pct IS NOT NULL AND c.discount_premium_pct > 0)
  )
  AND CAST(JSON_UNQUOTE(JSON_EXTRACT(oi.pricing_snapshot,'$.base_price')) AS DECIMAL(15,2)) > 0
  AND CAST(JSON_UNQUOTE(JSON_EXTRACT(oi.pricing_snapshot,'$.computed_unit_price')) AS DECIMAL(15,2)) > 0
  AND (
    CAST(JSON_UNQUOTE(JSON_EXTRACT(oi.pricing_snapshot,'$.computed_unit_price')) AS DECIMAL(15,2))
    >
    ROUND(
      CAST(JSON_UNQUOTE(JSON_EXTRACT(oi.pricing_snapshot,'$.base_price')) AS DECIMAL(15,2))
      * (1 - (
        CASE JSON_UNQUOTE(JSON_EXTRACT(oi.pricing_snapshot,'$.tier'))
          WHEN 'gold' THEN CAST(c.discount_gold_pct AS DECIMAL(10,3))
          WHEN 'platinum' THEN CAST(c.discount_premium_pct AS DECIMAL(10,3))
          ELSE 0
        END
      ) / 100),
      2
    )
    + 0.01
  )
ORDER BY est_overcharge_line_total DESC
LIMIT 200;

