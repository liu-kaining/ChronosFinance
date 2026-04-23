-- Migration: Add 5 premium fundamental datasets
-- Date: 2026-04-23
-- Description:
--   1. daily_market_cap — historical daily market-cap per symbol
--   2. stock_universe float columns — free_float, float_shares, outstanding_shares + sync flags
--   3. sec_files — already supports 10-Q/8-K via existing form_type discriminator (no DDL needed)
--   4. valuation_dcf — advanced levered DCF valuation per symbol
--   5. sector_performance_series — historical sector return % and P/E ratios

BEGIN;

-- ═══════════════════════════════════════════════════════════════
-- 1. daily_market_cap
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS daily_market_cap (
    symbol      VARCHAR(20) NOT NULL,
    date        DATE        NOT NULL,
    market_cap  BIGINT,
    raw_payload JSONB       NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_daily_market_cap PRIMARY KEY (symbol, date)
);

CREATE INDEX IF NOT EXISTS ix_daily_market_cap_date
    ON daily_market_cap (date);

-- ═══════════════════════════════════════════════════════════════
-- 2. stock_universe — add float columns and new sync flags
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE stock_universe
    ADD COLUMN IF NOT EXISTS free_float          DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS float_shares        BIGINT,
    ADD COLUMN IF NOT EXISTS outstanding_shares  BIGINT;

ALTER TABLE stock_universe
    ADD COLUMN IF NOT EXISTS float_synced      BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS market_cap_synced BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS dcf_synced        BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS ix_stock_universe_float_synced
    ON stock_universe (float_synced);
CREATE INDEX IF NOT EXISTS ix_stock_universe_market_cap_synced
    ON stock_universe (market_cap_synced);
CREATE INDEX IF NOT EXISTS ix_stock_universe_dcf_synced
    ON stock_universe (dcf_synced);

-- ═══════════════════════════════════════════════════════════════
-- 3. sec_files — no DDL changes needed
--    The existing table already has form_type VARCHAR(16) and
--    the unique constraint uq_sec_file (symbol, form_type, fiscal_year, fiscal_period)
--    which naturally supports '10-Q' and '8-K' values.
--
--    However, widen fiscal_period to accommodate 8-K date-based values:
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE sec_files
    ALTER COLUMN fiscal_period TYPE VARCHAR(16);

-- ═══════════════════════════════════════════════════════════════
-- 4. valuation_dcf — historical daily DCF (valuation thermometer)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS valuation_dcf (
    symbol       VARCHAR(20) NOT NULL,
    date         DATE        NOT NULL,
    dcf          DOUBLE PRECISION,
    stock_price  DOUBLE PRECISION,
    raw_payload  JSONB       NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_valuation_dcf PRIMARY KEY (symbol, date)
);

CREATE INDEX IF NOT EXISTS ix_valuation_dcf_date
    ON valuation_dcf (date);

-- ═══════════════════════════════════════════════════════════════
-- 5. sector_performance_series
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sector_performance_series (
    sector      VARCHAR(100) NOT NULL,
    date        DATE         NOT NULL,
    metric      VARCHAR(32)  NOT NULL,
    value       DOUBLE PRECISION,
    raw_payload JSONB        NOT NULL,
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT pk_sector_performance PRIMARY KEY (sector, date, metric)
);

CREATE INDEX IF NOT EXISTS ix_sector_performance_date
    ON sector_performance_series (date);
CREATE INDEX IF NOT EXISTS ix_sector_performance_sector
    ON sector_performance_series (sector);

COMMIT;
