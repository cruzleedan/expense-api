-- WORK-0029: server-side step-up assurance and critical-permission invariant.
ALTER TABLE refresh_tokens
    ADD COLUMN IF NOT EXISTS step_up_verified_at TIMESTAMP WITH TIME ZONE;

UPDATE permissions
SET requires_mfa = false
WHERE requires_mfa IS NULL;

UPDATE permissions
SET requires_mfa = true
WHERE risk_level = 'critical';

ALTER TABLE permissions
    ALTER COLUMN requires_mfa SET DEFAULT false,
    ALTER COLUMN requires_mfa SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'permissions_critical_requires_mfa'
          AND conrelid = 'permissions'::regclass
    ) THEN
        ALTER TABLE permissions
            ADD CONSTRAINT permissions_critical_requires_mfa
            CHECK (risk_level IS DISTINCT FROM 'critical' OR requires_mfa);
    END IF;
END
$$;
