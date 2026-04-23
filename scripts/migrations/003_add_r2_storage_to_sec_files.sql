-- Migration: Add R2 cold storage support to sec_files
-- Date: 2026-04-23
-- Description:
--   1. Add storage_path column for R2 object path
--   2. Make raw_content nullable (cold-hot separation)
--   3. Add index on storage_path for fast lookups
--
-- Architecture: Cold-Hot Separation
--   - storage_path: R2 object path (primary storage)
--   - raw_content: Optional in-DB cache (can be purged)
--   - R2 path convention: sec_filings/{symbol}/{form_type}/{fiscal_year}_{fiscal_period}.json

BEGIN;

-- Add storage_path column
ALTER TABLE sec_files
    ADD COLUMN IF NOT EXISTS storage_path VARCHAR(255);

-- Add comment
COMMENT ON COLUMN sec_files.storage_path IS 'R2 object path, e.g. sec_filings/AAPL/10-K/2023_FY.json';

-- Make raw_content nullable (cold-hot separation)
ALTER TABLE sec_files
    ALTER COLUMN raw_content DROP NOT NULL;

-- Add index on storage_path for fast lookups
CREATE INDEX IF NOT EXISTS ix_sec_file_storage_path
    ON sec_files (storage_path);

-- Update comment on form_type to include 8-K
COMMENT ON COLUMN sec_files.form_type IS '''10-K'' or ''10-Q'' or ''8-K''';

COMMIT;
