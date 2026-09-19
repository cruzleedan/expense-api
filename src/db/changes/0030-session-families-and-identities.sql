-- WORK-0030: additive/idempotent. Apply with ON_ERROR_STOP and one transaction.
-- Never repair ambiguous external identity ownership by guessing or email matching.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM users WHERE (oauth_provider IS NULL) <> (oauth_id IS NULL)
        OR oauth_provider NOT IN ('google', 'facebook') OR btrim(oauth_id) = ''
    ) THEN RAISE EXCEPTION 'WORK-0030: incomplete or unsupported legacy external identity'; END IF;
    IF EXISTS (
        SELECT 1 FROM users WHERE oauth_provider IS NOT NULL
        GROUP BY oauth_provider, oauth_id HAVING count(*) > 1
    ) THEN RAISE EXCEPTION 'WORK-0030: duplicate legacy provider subject ownership'; END IF;
    IF EXISTS (SELECT 1 FROM refresh_tokens GROUP BY token_hash HAVING count(*) > 1)
    THEN RAISE EXCEPTION 'WORK-0030: duplicate refresh token hash'; END IF;
END $$;

ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS family_id UUID;
-- Default stays 1: requests from an old image during additive rollout must not
-- be mislabeled current. The new API explicitly writes auth_version=2.
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 1;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'refresh_tokens'::regclass
                   AND conname = 'refresh_tokens_auth_version_check') THEN
        ALTER TABLE refresh_tokens ADD CONSTRAINT refresh_tokens_auth_version_check CHECK (auth_version > 0);
    END IF;
END $$;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS family_created_at TIMESTAMPTZ;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ;
UPDATE refresh_tokens SET family_id = gen_random_uuid() WHERE family_id IS NULL;
UPDATE refresh_tokens SET family_created_at = COALESCE(created_at, CURRENT_TIMESTAMP)
    WHERE family_created_at IS NULL;
ALTER TABLE refresh_tokens ALTER COLUMN family_id SET DEFAULT gen_random_uuid();
ALTER TABLE refresh_tokens ALTER COLUMN family_id SET NOT NULL;
ALTER TABLE refresh_tokens ALTER COLUMN family_created_at SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE refresh_tokens ALTER COLUMN family_created_at SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_refresh_tokens_hash_unique ON refresh_tokens(token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_refresh_tokens_active_family ON refresh_tokens(family_id)
    WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_family ON refresh_tokens(user_id, family_id);

CREATE TABLE IF NOT EXISTS user_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL CHECK (provider IN ('google', 'facebook')),
    subject VARCHAR(255) NOT NULL CHECK (length(btrim(subject)) > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT user_identities_provider_subject_unique UNIQUE(provider, subject)
);
CREATE INDEX IF NOT EXISTS idx_user_identities_user ON user_identities(user_id);
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM users u JOIN user_identities i
          ON i.provider = u.oauth_provider AND i.subject = u.oauth_id
        WHERE i.user_id <> u.id
    ) THEN RAISE EXCEPTION 'WORK-0030: identity table conflicts with legacy ownership'; END IF;
END $$;
INSERT INTO user_identities(user_id, provider, subject)
SELECT id, oauth_provider, oauth_id FROM users WHERE oauth_provider IS NOT NULL
ON CONFLICT(provider, subject) DO NOTHING;
-- Legacy columns retained for additive rollback compatibility, no longer read/
-- written for authentication. No bootstrap, grants, erasure, or role-version
-- changes. Runtime auth_version=2 is the documented sign-in cutover.
