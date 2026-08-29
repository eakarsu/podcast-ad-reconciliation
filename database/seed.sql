-- Seed Data for Podcast Advertising Reconciliation
-- Assumes schema.sql has been run. Uses ON CONFLICT for idempotency.

-- 1. Organization
INSERT INTO organizations (id, name)
VALUES ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Podcast Media Group')
ON CONFLICT (id) DO NOTHING;

-- 1b. Demo admin user (password: demo1234 — scrypt hash, change in production)
-- Format: scrypt:<saltHex>:<hashHex>, verified by server/lib/auth.mjs
INSERT INTO users (id, organization_id, email, password_hash, name, role)
VALUES (
  'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12',
  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  'admin@signalledger.local',
  'scrypt:a1b2c3d4e5f60718293a4b5c6d7e8f9a:02aaaebe235c35b210d0eb7f0b587d0545e646e106dbef84737cb0c4f3a97fed3bcfe2dbf06c75c8e0d7419126494d6e2cc3b46cf3582c8c8d6c36ff086e971b',
  'Demo Admin',
  'admin'
) ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  name = EXCLUDED.name,
  role = EXCLUDED.role;

-- 2. Shows
INSERT INTO shows (id, organization_id, title, category) VALUES
('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Tech Today', 'Technology'),
('c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'History Buffs', 'Education'),
('d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'True Crime Weekly', 'Entertainment')
ON CONFLICT (id) DO NOTHING;

-- 3. Advertisers
INSERT INTO advertisers (id, organization_id, name, contact_email) VALUES
('e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'CloudCorp Inc.', 'ads@cloudcorp.com'),
('f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'BookWorm Ltd.', 'marketing@bookworm.com'),
('00eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'SafeDrive Insurance', 'partners@safedrive.com')
ON CONFLICT (id) DO NOTHING;

-- 4. Campaigns (IOs)
-- Using fixed UUIDs for deterministic seeding
INSERT INTO campaigns (id, organization_id, show_id, advertiser_id, io_number, status, start_date, end_date, committed_impressions, cpm) VALUES
-- Active Campaign 1: Tech Today / CloudCorp
('10eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'IO-2023-001', 'active', '2023-10-01', '2023-12-31', 100000, 25.00),
-- Completed Campaign 2: History Buffs / BookWorm
('20eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'IO-2023-002', 'completed', '2023-07-01', '2023-09-30', 50000, 18.50),
-- Paused Campaign 3: True Crime / SafeDrive
('30eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', '00eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'IO-2023-003', 'paused', '2023-11-01', '2024-01-31', 75000, 30.00),
-- Draft Campaign 4: Tech Today / BookWorm
('40eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'IO-2024-001', 'draft', '2024-01-01', '2024-03-31', 120000, 22.00),
-- Active Campaign 5: History / CloudCorp
('50eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'IO-2023-004', 'active', '2023-10-15', '2023-12-15', 40000, 20.00),
-- Cancelled Campaign 6: True Crime / BookWorm
('60eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'IO-2023-005', 'cancelled', '2023-08-01', '2023-08-31', 10000, 15.00),
-- Active Campaign 7: Tech / SafeDrive
('70eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', '00eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'IO-2023-006', 'active', '2023-11-01', '2024-02-01', 90000, 28.00),
-- Completed Campaign 8: History / SafeDrive
('80eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', '00eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'IO-2023-007', 'completed', '2023-05-01', '2023-06-30', 60000, 19.00),
-- Active Campaign 9: True Crime / CloudCorp
('90eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'IO-2023-008', 'active', '2023-10-01', '2023-12-31', 110000, 26.00),
-- Draft Campaign 10: Tech / CloudCorp
('a1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'IO-2024-002', 'draft', '2024-02-01', '2024-04-30', 80000, 24.00)
ON CONFLICT (id) DO NOTHING;

-- 5. Delivery Records
-- Simulating daily or weekly delivery for active/completed campaigns
INSERT INTO delivery_records (campaign_id, date, impressions_delivered, source) VALUES
-- Campaign 1 (Active, ~60% delivered)
('10eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', '2023-10-07', 15000, 'ad_server'),
('10eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', '2023-10-14', 14500, 'ad_server'),
('10eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', '2023-10-21', 15200, 'ad_server'),
('10eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', '2023-10-28', 14800, 'ad_server'),
-- Campaign 2 (Completed, 100% delivered)
('20eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', '2023-07-15', 25000, 'ad_server'),
('20eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', '2023-08-15', 25000, 'ad_server'),
-- Campaign 3 (Paused, ~20% delivered)
('30eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', '2023-11-05', 10000, 'ad_server'),
('30eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', '2023-11-12', 5000, 'ad_server'),
-- Campaign 5 (Active, ~80% delivered)
('50eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', '2023-10-20', 16000, 'ad_server'),
('50eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', '2023-10-27', 16000, 'ad_server'),
-- Campaign 7 (Active, ~40% delivered)
('70eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', '2023-11-05', 18000, 'ad_server'),
('70eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', '2023-11-12', 18000, 'ad_server'),
-- Campaign 8 (Completed, 100% delivered)
('80eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', '2023-05-15', 30000, 'ad_server'),
('80eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', '2023-06-15', 30000, 'ad_server'),
-- Campaign 9 (Active, ~50% delivered)
('90eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', '2023-10-15', 27500, 'ad_server'),
('90eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', '2023-10-22', 27500, 'ad_server')
ON CONFLICT (campaign_id, date, source) DO NOTHING;

-- 6. Airchecks
INSERT INTO airchecks (campaign_id, episode_title, aircheck_url, notes) VALUES
('10eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Ep 101: AI Trends', 'https://example.com/aircheck/101', 'Verified'),
('20eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Ep 50: Roman Empire', 'https://example.com/aircheck/50', 'Verified'),
('50eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Ep 12: Medieval Times', 'https://example.com/aircheck/12', 'Pending Review')
ON CONFLICT (campaign_id, episode_title) DO NOTHING;

-- 7. Reconciliation Issues
INSERT INTO reconciliation_issues (campaign_id, type, severity, description, resolved) VALUES
('10eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'under_delivery', 'medium', 'Pacing behind schedule by 15%', false),
('30eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'missing_aircheck', 'high', 'No aircheck provided for Nov 12 delivery', false),
('50eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'discrepancy', 'low', 'Ad server count differs from publisher report by 2%', false)
ON CONFLICT (campaign_id, type, description) DO NOTHING;

-- 8. Makegoods
INSERT INTO makegoods (campaign_id, issue_id, impressions_granted, value, status) VALUES
('10eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', (SELECT id FROM reconciliation_issues WHERE campaign_id = '10eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' AND type = 'under_delivery' LIMIT 1), 5000, 125.00, 'approved')
ON CONFLICT (issue_id) DO NOTHING;

-- 9. Activity Events
INSERT INTO activity_events (id, organization_id, entity_type, entity_id, action, details) VALUES
('00000000-0000-0000-0000-000000000001', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'campaign', '10eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'created', '{"io_number": "IO-2023-001"}'),
('00000000-0000-0000-0000-000000000002', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'campaign', '10eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'status_changed', '{"from": "draft", "to": "active"}'),
('00000000-0000-0000-0000-000000000003', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'issue', '10eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'created', '{"type": "under_delivery"}')
ON CONFLICT (id) DO NOTHING;
