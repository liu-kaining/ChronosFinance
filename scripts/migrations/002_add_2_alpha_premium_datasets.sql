-- Migration: Add 2 alpha premium datasets
-- Date: 2026-04-23
-- Description:
--   1. company_employees_history — historical employee count per symbol
--   2. equity_offerings — equity offering events (secondary offerings, follow-on)

BEGIN;

-- ═══════════════════════════════════════════════════════════════
-- 1. company_employees_history
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS company_employees_history (
    symbol         VARCHAR(20) NOT NULL,
    date           DATE        NOT NULL,
    employee_count BIGINT,
    raw_payload    JSONB       NOT NULL,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_company_employees_history PRIMARY KEY (symbol, date)
);

-- ═══════════════════════════════════════════════════════════════
-- 2. equity_offerings
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS equity_offerings (
    id              SERIAL PRIMARY KEY,
    symbol          VARCHAR(20)  NOT NULL,
    filing_date     DATE,
    offering_date   DATE,
    offering_amount DOUBLE PRECISION,
    shares_offered  BIGINT,
    offering_price  DOUBLE PRECISION,
    offering_type   VARCHAR(64),
    raw_payload     JSONB        NOT NULL,
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_equity_offering UNIQUE (symbol, filing_date, offering_amount)
);

CREATE INDEX IF NOT EXISTS ix_equity_offerings_symbol
    ON equity_offerings (symbol);
CREATE INDEX IF NOT EXISTS ix_equity_offerings_filing_date
    ON equity_offerings (filing_date);

COMMIT;
