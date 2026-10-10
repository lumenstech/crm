CREATE TABLE IF NOT EXISTS "jwks" (
    "id" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "jwks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "oauthClient" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT,
    "disabled" BOOLEAN DEFAULT false,
    "skipConsent" BOOLEAN,
    "enableEndSession" BOOLEAN,
    "subjectType" TEXT,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "userId" TEXT,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),
    "name" TEXT,
    "uri" TEXT,
    "icon" TEXT,
    "contacts" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "tos" TEXT,
    "policy" TEXT,
    "softwareId" TEXT,
    "softwareVersion" TEXT,
    "softwareStatement" TEXT,
    "redirectUris" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "postLogoutRedirectUris" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "tokenEndpointAuthMethod" TEXT,
    "grantTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "responseTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "public" BOOLEAN,
    "type" TEXT,
    "requirePKCE" BOOLEAN,
    "referenceId" TEXT,
    "metadata" JSONB,

    CONSTRAINT "oauthClient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "oauthRefreshToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "sessionId" TEXT,
    "userId" TEXT NOT NULL,
    "referenceId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "revoked" TIMESTAMP(3),
    "authTime" TIMESTAMP(3),
    "scopes" TEXT[] NOT NULL,

    CONSTRAINT "oauthRefreshToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "oauthAccessToken" (
    "id" TEXT NOT NULL,
    "token" TEXT,
    "clientId" TEXT NOT NULL,
    "sessionId" TEXT,
    "userId" TEXT,
    "referenceId" TEXT,
    "refreshId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "scopes" TEXT[] NOT NULL,

    CONSTRAINT "oauthAccessToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "oauthConsent" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT,
    "referenceId" TEXT,
    "scopes" TEXT[] NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauthConsent_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "oauthAccessToken"
ADD COLUMN IF NOT EXISTS "token" TEXT;

-- Reconcile the legacy Better Auth OAuth tables without inventing credentials,
-- identities, expiry values, or permission grants. Required columns are added
-- without defaults so populated legacy tables fail safely instead of receiving
-- fabricated authorization data.
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE "jwks" ADD COLUMN IF NOT EXISTS "id" TEXT NOT NULL;
ALTER TABLE "jwks" ADD COLUMN IF NOT EXISTS "publicKey" TEXT NOT NULL;
ALTER TABLE "jwks" ADD COLUMN IF NOT EXISTS "privateKey" TEXT NOT NULL;
ALTER TABLE "jwks" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL;
ALTER TABLE "jwks" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);
ALTER TABLE "oauthClient" ADD COLUMN IF NOT EXISTS "id" TEXT NOT NULL;
ALTER TABLE "oauthClient" ADD COLUMN IF NOT EXISTS "clientId" TEXT NOT NULL;
ALTER TABLE "oauthClient" ADD COLUMN IF NOT EXISTS "clientSecret" TEXT;
ALTER TABLE "oauthClient" ADD COLUMN IF NOT EXISTS "disabled" BOOLEAN DEFAULT false;
ALTER TABLE "oauthClient" ADD COLUMN IF NOT EXISTS "skipConsent" BOOLEAN;
ALTER TABLE "oauthClient" ADD COLUMN IF NOT EXISTS "enableEndSession" BOOLEAN;
ALTER TABLE "oauthClient" ADD COLUMN IF NOT EXISTS "subjectType" TEXT;
ALTER TABLE "oauthClient" ADD COLUMN IF NOT EXISTS "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "oauthClient" ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "oauthClient" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3);
ALTER TABLE "oauthClient" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
ALTER TABLE "oauthClient" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "oauthClient" ADD COLUMN IF NOT EXISTS "uri" TEXT;
ALTER TABLE "oauthClient" ADD COLUMN IF NOT EXISTS "icon" TEXT;
ALTER TABLE "oauthClient" ADD COLUMN IF NOT EXISTS "contacts" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "oauthClient" ADD COLUMN IF NOT EXISTS "tos" TEXT;
ALTER TABLE "oauthClient" ADD COLUMN IF NOT EXISTS "policy" TEXT;
ALTER TABLE "oauthClient" ADD COLUMN IF NOT EXISTS "softwareId" TEXT;
ALTER TABLE "oauthClient" ADD COLUMN IF NOT EXISTS "softwareVersion" TEXT;
ALTER TABLE "oauthClient" ADD COLUMN IF NOT EXISTS "softwareStatement" TEXT;
ALTER TABLE "oauthClient" ADD COLUMN IF NOT EXISTS "redirectUris" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "oauthClient" ADD COLUMN IF NOT EXISTS "postLogoutRedirectUris" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "oauthClient" ADD COLUMN IF NOT EXISTS "tokenEndpointAuthMethod" TEXT;
ALTER TABLE "oauthClient" ADD COLUMN IF NOT EXISTS "grantTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "oauthClient" ADD COLUMN IF NOT EXISTS "responseTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "oauthClient" ADD COLUMN IF NOT EXISTS "public" BOOLEAN;
ALTER TABLE "oauthClient" ADD COLUMN IF NOT EXISTS "type" TEXT;
ALTER TABLE "oauthClient" ADD COLUMN IF NOT EXISTS "requirePKCE" BOOLEAN;
ALTER TABLE "oauthClient" ADD COLUMN IF NOT EXISTS "referenceId" TEXT;
ALTER TABLE "oauthClient" ADD COLUMN IF NOT EXISTS "metadata" JSONB;
ALTER TABLE "oauthRefreshToken" ADD COLUMN IF NOT EXISTS "id" TEXT NOT NULL;
ALTER TABLE "oauthRefreshToken" ADD COLUMN IF NOT EXISTS "token" TEXT NOT NULL;
ALTER TABLE "oauthRefreshToken" ADD COLUMN IF NOT EXISTS "clientId" TEXT NOT NULL;
ALTER TABLE "oauthRefreshToken" ADD COLUMN IF NOT EXISTS "sessionId" TEXT;
ALTER TABLE "oauthRefreshToken" ADD COLUMN IF NOT EXISTS "userId" TEXT NOT NULL;
ALTER TABLE "oauthRefreshToken" ADD COLUMN IF NOT EXISTS "referenceId" TEXT;
ALTER TABLE "oauthRefreshToken" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3) NOT NULL;
ALTER TABLE "oauthRefreshToken" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL;
ALTER TABLE "oauthRefreshToken" ADD COLUMN IF NOT EXISTS "revoked" TIMESTAMP(3);
ALTER TABLE "oauthRefreshToken" ADD COLUMN IF NOT EXISTS "authTime" TIMESTAMP(3);
ALTER TABLE "oauthRefreshToken" ADD COLUMN IF NOT EXISTS "scopes" TEXT[] NOT NULL;
ALTER TABLE "oauthAccessToken" ADD COLUMN IF NOT EXISTS "id" TEXT NOT NULL;
ALTER TABLE "oauthAccessToken" ADD COLUMN IF NOT EXISTS "clientId" TEXT NOT NULL;
ALTER TABLE "oauthAccessToken" ADD COLUMN IF NOT EXISTS "sessionId" TEXT;
ALTER TABLE "oauthAccessToken" ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "oauthAccessToken" ADD COLUMN IF NOT EXISTS "referenceId" TEXT;
ALTER TABLE "oauthAccessToken" ADD COLUMN IF NOT EXISTS "refreshId" TEXT;
ALTER TABLE "oauthAccessToken" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3) NOT NULL;
ALTER TABLE "oauthAccessToken" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL;
ALTER TABLE "oauthAccessToken" ADD COLUMN IF NOT EXISTS "scopes" TEXT[] NOT NULL;
ALTER TABLE "oauthConsent" ADD COLUMN IF NOT EXISTS "id" TEXT NOT NULL;
ALTER TABLE "oauthConsent" ADD COLUMN IF NOT EXISTS "clientId" TEXT NOT NULL;
ALTER TABLE "oauthConsent" ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "oauthConsent" ADD COLUMN IF NOT EXISTS "referenceId" TEXT;
ALTER TABLE "oauthConsent" ADD COLUMN IF NOT EXISTS "scopes" TEXT[] NOT NULL;
ALTER TABLE "oauthConsent" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL;
ALTER TABLE "oauthConsent" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL;

CREATE OR REPLACE FUNCTION pg_temp.comp_crm_legacy_scopes(raw_value text)
RETURNS text[] LANGUAGE plpgsql IMMUTABLE STRICT AS $comp_scope_fn$
DECLARE
  items text[];
  payload jsonb;
  item text;
  trimmed text;
BEGIN
  trimmed := btrim(raw_value, E' \t\r\n');
  IF trimmed = '' THEN
    RETURN ARRAY[]::text[];
  ELSIF left(trimmed, 1) = '[' THEN
    BEGIN
      payload := raw_value::jsonb;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Malformed JSON scope array; transaction cancelled.';
    END;
    IF jsonb_typeof(payload) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Legacy scopes must be an array; transaction cancelled.';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(payload) AS x(value)
               WHERE jsonb_typeof(x.value) IS DISTINCT FROM 'string') THEN
      RAISE EXCEPTION 'Non-string scope value; transaction cancelled.';
    END IF;
    SELECT COALESCE(array_agg(x.value ORDER BY x.ord), ARRAY[]::text[])
      INTO items
      FROM jsonb_array_elements_text(payload) WITH ORDINALITY AS x(value, ord);
  ELSE
    IF left(trimmed, 1) IN ('[', '{', '"', chr(39))
       OR trimmed IN ('null', 'true', 'false') THEN
      RAISE EXCEPTION 'Ambiguous legacy scope encoding; transaction cancelled.';
    END IF;
    items := regexp_split_to_array(trimmed, ' +');
  END IF;
  FOREACH item IN ARRAY items LOOP
    IF item IS NULL OR item = '' OR NOT (item COLLATE "C" ~ '^[!-~]+$')
       OR position('"' IN item) > 0 OR position(chr(92) IN item) > 0 THEN
      RAISE EXCEPTION 'Invalid OAuth scope token; transaction cancelled.';
    END IF;
  END LOOP;
  RETURN items;
END;
$comp_scope_fn$;

DO $comp_scope_selftest$
BEGIN
  IF pg_temp.comp_crm_legacy_scopes('[]') IS DISTINCT FROM ARRAY[]::text[]
     OR pg_temp.comp_crm_legacy_scopes(' crm:read  CRM:Write ')
        IS DISTINCT FROM ARRAY['crm:read','CRM:Write']::text[]
     OR pg_temp.comp_crm_legacy_scopes('["crm:read","CRM:Write"]')
        IS DISTINCT FROM ARRAY['crm:read','CRM:Write']::text[] THEN
    RAISE EXCEPTION 'Scope converter self-test failed; transaction cancelled.';
  END IF;
END;
$comp_scope_selftest$;

DO $comp_scope_migrate$
DECLARE
  table_name text;
  column_type text;
  default_sql text;
  default_items text[];
  before_values jsonb;
  after_values jsonb;
  row_count bigint;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['oauthAccessToken', 'oauthConsent'] LOOP
    EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', table_name);
    SELECT format_type(a.atttypid, a.atttypmod), pg_get_expr(d.adbin, d.adrelid)
      INTO column_type, default_sql
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE n.nspname = 'public' AND c.relname = table_name
        AND a.attname = 'scopes' AND a.attnum > 0 AND NOT a.attisdropped;
    IF column_type = 'text[]' THEN
      CONTINUE;
    END IF;
    IF column_type IS DISTINCT FROM 'text' THEN
      RAISE EXCEPTION 'Unexpected scopes type in %; transaction cancelled.', table_name;
    END IF;
    EXECUTE format('SELECT count(*) FROM public.%I', table_name) INTO row_count;
    IF row_count > 100000 THEN
      RAISE EXCEPTION 'Scope table % exceeds bounded migration size; transaction cancelled.', table_name;
    END IF;
    IF default_sql IS NOT NULL AND default_sql !~ $default_pattern$^('([^']|'')*'|NULL)::text$$default_pattern$ THEN
      RAISE EXCEPTION 'Unsupported scope default in %; transaction cancelled.', table_name;
    END IF;
    before_values := NULL;
    EXECUTE format(
      'SELECT COALESCE(jsonb_agg(jsonb_build_array("id", pg_temp.comp_crm_legacy_scopes("scopes")) ORDER BY "id"), ''[]''::jsonb) FROM public.%I',
      table_name) INTO before_values;
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN "scopes" DROP DEFAULT', table_name);
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN "scopes" TYPE text[] USING pg_temp.comp_crm_legacy_scopes("scopes")',
      table_name);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN "scopes" SET NOT NULL', table_name);
    IF default_sql IS NOT NULL AND default_sql <> 'NULL::text' THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN "scopes" SET DEFAULT %L::text[]',
                     table_name, pg_temp.comp_crm_legacy_scopes(substring(default_sql from 2 for length(default_sql) - 7)));
    END IF;
    EXECUTE format(
      'SELECT COALESCE(jsonb_agg(jsonb_build_array("id", "scopes") ORDER BY "id"), ''[]''::jsonb) FROM public.%I',
      table_name) INTO after_values;
    IF before_values IS DISTINCT FROM after_values THEN
      RAISE EXCEPTION 'Scope preservation check failed in %; transaction cancelled.', table_name;
    END IF;
  END LOOP;
END;
$comp_scope_migrate$;

CREATE UNIQUE INDEX IF NOT EXISTS "oauthClient_clientId_key" ON "oauthClient"("clientId");
CREATE INDEX IF NOT EXISTS "oauthClient_userId_idx" ON "oauthClient"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "oauthRefreshToken_token_key" ON "oauthRefreshToken"("token");
CREATE INDEX IF NOT EXISTS "oauthRefreshToken_clientId_idx" ON "oauthRefreshToken"("clientId");
CREATE INDEX IF NOT EXISTS "oauthRefreshToken_sessionId_idx" ON "oauthRefreshToken"("sessionId");
CREATE INDEX IF NOT EXISTS "oauthRefreshToken_userId_idx" ON "oauthRefreshToken"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "oauthAccessToken_token_key" ON "oauthAccessToken"("token");
CREATE INDEX IF NOT EXISTS "oauthAccessToken_clientId_idx" ON "oauthAccessToken"("clientId");
CREATE INDEX IF NOT EXISTS "oauthAccessToken_sessionId_idx" ON "oauthAccessToken"("sessionId");
CREATE INDEX IF NOT EXISTS "oauthAccessToken_userId_idx" ON "oauthAccessToken"("userId");
CREATE INDEX IF NOT EXISTS "oauthAccessToken_refreshId_idx" ON "oauthAccessToken"("refreshId");
CREATE INDEX IF NOT EXISTS "oauthConsent_clientId_idx" ON "oauthConsent"("clientId");
CREATE INDEX IF NOT EXISTS "oauthConsent_userId_idx" ON "oauthConsent"("userId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'oauthClient_userId_fkey'
    ) THEN
        ALTER TABLE "oauthClient"
        ADD CONSTRAINT "oauthClient_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'oauthRefreshToken_clientId_fkey'
    ) THEN
        ALTER TABLE "oauthRefreshToken"
        ADD CONSTRAINT "oauthRefreshToken_clientId_fkey"
        FOREIGN KEY ("clientId") REFERENCES "oauthClient"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'oauthRefreshToken_sessionId_fkey'
    ) THEN
        ALTER TABLE "oauthRefreshToken"
        ADD CONSTRAINT "oauthRefreshToken_sessionId_fkey"
        FOREIGN KEY ("sessionId") REFERENCES "session"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'oauthRefreshToken_userId_fkey'
    ) THEN
        ALTER TABLE "oauthRefreshToken"
        ADD CONSTRAINT "oauthRefreshToken_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'oauthAccessToken_clientId_fkey'
    ) THEN
        ALTER TABLE "oauthAccessToken"
        ADD CONSTRAINT "oauthAccessToken_clientId_fkey"
        FOREIGN KEY ("clientId") REFERENCES "oauthClient"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'oauthAccessToken_sessionId_fkey'
    ) THEN
        ALTER TABLE "oauthAccessToken"
        ADD CONSTRAINT "oauthAccessToken_sessionId_fkey"
        FOREIGN KEY ("sessionId") REFERENCES "session"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'oauthAccessToken_userId_fkey'
    ) THEN
        ALTER TABLE "oauthAccessToken"
        ADD CONSTRAINT "oauthAccessToken_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'oauthAccessToken_refreshId_fkey'
    ) THEN
        ALTER TABLE "oauthAccessToken"
        ADD CONSTRAINT "oauthAccessToken_refreshId_fkey"
        FOREIGN KEY ("refreshId") REFERENCES "oauthRefreshToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'oauthConsent_clientId_fkey'
    ) THEN
        ALTER TABLE "oauthConsent"
        ADD CONSTRAINT "oauthConsent_clientId_fkey"
        FOREIGN KEY ("clientId") REFERENCES "oauthClient"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'oauthConsent_userId_fkey'
    ) THEN
        ALTER TABLE "oauthConsent"
        ADD CONSTRAINT "oauthConsent_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;
