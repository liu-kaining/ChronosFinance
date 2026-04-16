-- ══════════════════════════════════════════════════════════════════
-- Chronos Finance — sync progress dashboard (Phase 1-5)
-- Usage:
--   docker-compose exec -T db \
--     psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f - < scripts/monitor_progress.sql
-- ══════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────
-- 1. All 16 sync-flag counts in one wide row.
--    Denominator = active-symbol universe.
-- ──────────────────────────────────────────────
WITH active AS (
    SELECT * FROM stock_universe WHERE is_actively_trading
)
SELECT
    (SELECT COUNT(*) FROM active) AS active_symbols,
    -- Phase 2
    COUNT(*) FILTER (WHERE income_synced)       AS income,
    COUNT(*) FILTER (WHERE balance_synced)      AS balance,
    COUNT(*) FILTER (WHERE cashflow_synced)     AS cashflow,
    -- Phase 3
    COUNT(*) FILTER (WHERE ratios_synced)       AS ratios,
    COUNT(*) FILTER (WHERE metrics_synced)      AS metrics,
    COUNT(*) FILTER (WHERE scores_synced)       AS scores,
    COUNT(*) FILTER (WHERE ev_synced)           AS ev,
    COUNT(*) FILTER (WHERE compensation_synced) AS compensation,
    COUNT(*) FILTER (WHERE segments_synced)     AS segments,
    COUNT(*) FILTER (WHERE peers_synced)        AS peers,
    -- Phase 4
    COUNT(*) FILTER (WHERE prices_synced)       AS prices,
    COUNT(*) FILTER (WHERE actions_synced)      AS actions,
    COUNT(*) FILTER (WHERE earnings_synced)     AS earnings,
    -- Phase 5
    COUNT(*) FILTER (WHERE insider_synced)      AS insider,
    COUNT(*) FILTER (WHERE estimates_synced)    AS estimates,
    COUNT(*) FILTER (WHERE filings_synced)      AS filings
FROM active;


-- ──────────────────────────────────────────────
-- 2. Long-form per-dataset completion percentage,
--    ordered by progress so laggards float to the top.
-- ──────────────────────────────────────────────
WITH active AS (
    SELECT * FROM stock_universe WHERE is_actively_trading
),
totals AS (SELECT COUNT(*)::numeric AS n FROM active)
SELECT
    label,
    done,
    totals.n::int                                   AS total,
    ROUND(100.0 * done / NULLIF(totals.n, 0), 2)    AS pct
FROM totals,
     LATERAL (
         VALUES
             ('2. income',        (SELECT COUNT(*) FROM active WHERE income_synced)),
             ('2. balance',       (SELECT COUNT(*) FROM active WHERE balance_synced)),
             ('2. cashflow',      (SELECT COUNT(*) FROM active WHERE cashflow_synced)),
             ('3. ratios',        (SELECT COUNT(*) FROM active WHERE ratios_synced)),
             ('3. metrics',       (SELECT COUNT(*) FROM active WHERE metrics_synced)),
             ('3. scores',        (SELECT COUNT(*) FROM active WHERE scores_synced)),
             ('3. ev',            (SELECT COUNT(*) FROM active WHERE ev_synced)),
             ('3. compensation',  (SELECT COUNT(*) FROM active WHERE compensation_synced)),
             ('3. segments',      (SELECT COUNT(*) FROM active WHERE segments_synced)),
             ('3. peers',         (SELECT COUNT(*) FROM active WHERE peers_synced)),
             ('4. prices',        (SELECT COUNT(*) FROM active WHERE prices_synced)),
             ('4. actions',       (SELECT COUNT(*) FROM active WHERE actions_synced)),
             ('4. earnings',      (SELECT COUNT(*) FROM active WHERE earnings_synced)),
             ('5. insider',       (SELECT COUNT(*) FROM active WHERE insider_synced)),
             ('5. estimates',     (SELECT COUNT(*) FROM active WHERE estimates_synced)),
             ('5. filings',       (SELECT COUNT(*) FROM active WHERE filings_synced))
     ) AS v(label, done)
ORDER BY pct;


-- ──────────────────────────────────────────────
-- 3. Row counts + year span in static_financials
--    (Phase 2 / 3 payloads).
-- ──────────────────────────────────────────────
SELECT
    data_category,
    period,
    COUNT(*)                        AS rows,
    COUNT(DISTINCT symbol)          AS symbols,
    MIN(fiscal_year)                AS min_year,
    MAX(fiscal_year)                AS max_year,
    MAX(updated_at)                 AS last_write
FROM static_financials
GROUP BY data_category, period
ORDER BY data_category;


-- ──────────────────────────────────────────────
-- 4. Phase 4 / 5 table sizes at a glance.
-- ──────────────────────────────────────────────
SELECT 'daily_prices'       AS tbl, COUNT(*) AS rows, COUNT(DISTINCT symbol)    AS symbols FROM daily_prices
UNION ALL
SELECT 'corporate_actions',       COUNT(*),             COUNT(DISTINCT symbol)             FROM corporate_actions
UNION ALL
SELECT 'earnings_calendar',       COUNT(*),             COUNT(DISTINCT symbol)             FROM earnings_calendar
UNION ALL
SELECT 'insider_trades',          COUNT(*),             COUNT(DISTINCT symbol)             FROM insider_trades
UNION ALL
SELECT 'analyst_estimates',       COUNT(*),             COUNT(DISTINCT symbol)             FROM analyst_estimates
UNION ALL
SELECT 'sec_files',               COUNT(*),             COUNT(DISTINCT symbol)             FROM sec_files
UNION ALL
SELECT 'macro_economics',         COUNT(*),             COUNT(DISTINCT series_id)          FROM macro_economics
ORDER BY tbl;


-- ──────────────────────────────────────────────
-- 5. (Optional) List laggards for any given dataset.
--    Uncomment the flag column you are monitoring.
-- ──────────────────────────────────────────────
-- SELECT symbol FROM stock_universe
--  WHERE is_actively_trading AND NOT prices_synced
--  ORDER BY symbol LIMIT 20;
