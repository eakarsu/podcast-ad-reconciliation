-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Organizations
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users (auth)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT,
    role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'member')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sessions (cookie auth)
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

-- Shows
CREATE TABLE IF NOT EXISTS shows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    category TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, title)
);

-- Advertisers
CREATE TABLE IF NOT EXISTS advertisers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    contact_email TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, name)
);

-- Campaigns / Insertion Orders
CREATE TABLE IF NOT EXISTS campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    show_id UUID NOT NULL REFERENCES shows(id) ON DELETE RESTRICT,
    advertiser_id UUID NOT NULL REFERENCES advertisers(id) ON DELETE RESTRICT,
    io_number TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'paused', 'completed', 'cancelled')) DEFAULT 'draft',
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    committed_impressions BIGINT NOT NULL,
    cpm NUMERIC(10, 2) NOT NULL,
    total_budget NUMERIC(12, 2) GENERATED ALWAYS AS (committed_impressions * cpm / 1000.0) STORED,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, io_number)
);

-- Delivery Records
CREATE TABLE IF NOT EXISTS delivery_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    impressions_delivered BIGINT NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'ad_server', -- e.g., ad_server, manual, api
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(campaign_id, date, source)
);

-- Airchecks
CREATE TABLE IF NOT EXISTS airchecks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    episode_title TEXT,
    aircheck_url TEXT,
    verified_at TIMESTAMPTZ DEFAULT NOW(),
    notes TEXT
);

-- Reconciliation Issues
CREATE TABLE IF NOT EXISTS reconciliation_issues (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('under_delivery', 'over_delivery', 'missing_aircheck', 'discrepancy')),
    severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')) DEFAULT 'medium',
    description TEXT NOT NULL,
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Makegoods
CREATE TABLE IF NOT EXISTS makegoods (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    issue_id UUID REFERENCES reconciliation_issues(id) ON DELETE SET NULL,
    impressions_granted BIGINT NOT NULL,
    value NUMERIC(12, 2) NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'delivered')) DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Activity Events
CREATE TABLE IF NOT EXISTS activity_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL, -- campaign, issue, etc.
    entity_id UUID NOT NULL,
    action TEXT NOT NULL, -- created, updated, status_changed
    details JSONB,
    user_id TEXT, -- optional external user ID
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_dates ON campaigns(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_delivery_campaign_date ON delivery_records(campaign_id, date);
CREATE INDEX IF NOT EXISTS idx_activity_org_time ON activity_events(organization_id, created_at DESC);

-- Product expansion: podcast profiles, episodes, integrations, invoicing, alerts, and administration
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/New_York';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS invoice_prefix TEXT NOT NULL DEFAULT 'SL';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS payment_terms_days INTEGER NOT NULL DEFAULT 30;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS alert_email TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS automatic_alerts BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'member', 'viewer'));

ALTER TABLE shows ADD COLUMN IF NOT EXISTS rss_url TEXT;
ALTER TABLE shows ADD COLUMN IF NOT EXISTS cover_art_url TEXT;
ALTER TABLE shows ADD COLUMN IF NOT EXISTS network TEXT;
ALTER TABLE shows ADD COLUMN IF NOT EXISTS host TEXT;
ALTER TABLE shows ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE shows ADD COLUMN IF NOT EXISTS website_url TEXT;
ALTER TABLE shows ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en';
ALTER TABLE shows ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS uq_shows_org_rss ON shows(organization_id, rss_url) WHERE rss_url IS NOT NULL;

CREATE TABLE IF NOT EXISTS episodes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    guid TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    published_at TIMESTAMPTZ,
    duration_seconds INTEGER,
    audio_url TEXT,
    episode_number INTEGER,
    season_number INTEGER,
    explicit BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(show_id, guid)
);

CREATE TABLE IF NOT EXISTS ad_slots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    episode_id UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    slot_type TEXT NOT NULL CHECK (slot_type IN ('pre_roll', 'mid_roll', 'post_roll', 'host_read')) DEFAULT 'mid_roll',
    position_seconds INTEGER,
    duration_seconds INTEGER NOT NULL DEFAULT 60,
    status TEXT NOT NULL CHECK (status IN ('planned', 'aired', 'verified', 'missed')) DEFAULT 'planned',
    expected_impressions BIGINT NOT NULL DEFAULT 0,
    delivered_impressions BIGINT NOT NULL DEFAULT 0,
    aircheck_url TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS provider_integrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    integration_type TEXT NOT NULL CHECK (integration_type IN ('hosting', 'ad_server', 'email')),
    endpoint_url TEXT,
    api_key_env TEXT,
    status TEXT NOT NULL CHECK (status IN ('connected', 'paused', 'error')) DEFAULT 'paused',
    last_synced_at TIMESTAMPTZ,
    sync_error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, name)
);

CREATE TABLE IF NOT EXISTS integration_sync_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    integration_id UUID NOT NULL REFERENCES provider_integrations(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
    records_processed INTEGER NOT NULL DEFAULT 0,
    message TEXT,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    invoice_number TEXT NOT NULL,
    recipient_email TEXT,
    status TEXT NOT NULL CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'void')) DEFAULT 'draft',
    amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    issued_at TIMESTAMPTZ DEFAULT NOW(),
    due_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, invoice_number),
    UNIQUE(campaign_id)
);

CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    episode_id UUID REFERENCES episodes(id) ON DELETE CASCADE,
    alert_type TEXT NOT NULL CHECK (alert_type IN ('under_delivery', 'missing_aircheck', 'campaign_deadline', 'integration_error')),
    severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')) DEFAULT 'medium',
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open', 'dismissed', 'resolved')) DEFAULT 'open',
    due_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_episodes_show_published ON episodes(show_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_slots_episode ON ad_slots(episode_id);
CREATE INDEX IF NOT EXISTS idx_integrations_org ON provider_integrations(organization_id);
CREATE INDEX IF NOT EXISTS idx_invoices_org_status ON invoices(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_alerts_org_status ON alerts(organization_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ad_slots_episode_position ON ad_slots(episode_id, slot_type, position_seconds);
CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts_campaign_dedupe ON alerts(organization_id, campaign_id, alert_type, title) WHERE campaign_id IS NOT NULL;

-- Unique indexes to support ON CONFLICT clauses in seed/import scripts
CREATE UNIQUE INDEX IF NOT EXISTS uq_airchecks_campaign_episode ON airchecks(campaign_id, episode_title);
CREATE UNIQUE INDEX IF NOT EXISTS uq_recon_issues_campaign_type_desc ON reconciliation_issues(campaign_id, type, description);
CREATE UNIQUE INDEX IF NOT EXISTS uq_makegoods_issue ON makegoods(issue_id);
-- Drop the bad unique index that prevents legitimate repeated status/activity history
DROP INDEX IF EXISTS uq_activity_events_lookup;

-- View for summary stats used by API
CREATE OR REPLACE VIEW campaign_stats AS
SELECT
  c.id,
  c.status,
  c.committed_impressions,
  COALESCE(SUM(dr.impressions_delivered), 0) as delivered,
  COUNT(DISTINCT ri.id) FILTER (WHERE ri.resolved = false) as open_issues,
  SUM(mg.value) as makegood_value
FROM campaigns c
LEFT JOIN delivery_records dr ON c.id = dr.campaign_id
LEFT JOIN reconciliation_issues ri ON c.id = ri.campaign_id
LEFT JOIN makegoods mg ON c.id = mg.campaign_id AND mg.status = 'approved'
GROUP BY c.id, c.status, c.committed_impressions;
