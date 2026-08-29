export type CampaignStatus = "draft" | "active" | "paused" | "completed" | "cancelled";
export type PacingStatus = "not_started" | "on_track" | "slight_risk" | "at_risk" | "behind";
export type IssueType = "under_delivery" | "over_delivery" | "missing_aircheck" | "discrepancy";
export type IssueSeverity = "low" | "medium" | "high";

export interface Paginated<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
}

export interface AuthMe {
  user: AuthUser;
  organization: { id: string; name: string };
}

export interface Summary {
  committedRevenue: number;
  invoiceReadyRevenue: number;
  revenueAtRisk: number;
  deliveryAccuracy: number;
  activeCampaigns: number;
  openIssues: number;
  invoiceReadyCount: number;
  totalCampaigns: number;
  pacingCounts: Record<PacingStatus, number>;
}

export interface CampaignRow {
  id: string;
  io_number: string;
  show_title: string;
  advertiser_name: string;
  status: CampaignStatus;
  start_date: string;
  end_date: string;
  committed_impressions: number;
  cpm: number;
  delivered_impressions: number;
  open_issue_count: number;
  makegood_amount: number;
  variance_percent: number;
  pacing_status: PacingStatus;
  invoice_ready: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface DeliveryRecord {
  id: string;
  date: string;
  impressions_delivered: number;
  source: string;
  created_at?: string;
}

export interface Aircheck {
  id: string;
  episode_title: string | null;
  aircheck_url: string | null;
  notes: string | null;
  verified_at: string;
}

export interface ReconciliationIssue {
  id: string;
  campaign_id?: string;
  type: IssueType | string;
  severity?: IssueSeverity | string;
  description: string;
  resolved: boolean;
  created_at: string;
}

export interface Makegood {
  id: string;
  issue_id: string | null;
  impressions_granted: number;
  value: number;
  status: string;
  created_at: string;
}

export interface ActivityEvent {
  id: string;
  entity_type: string;
  action: string;
  details: unknown;
  created_at: string;
  io_number?: string | null;
  show_title?: string | null;
}

export interface CampaignDetail extends CampaignRow {
  delivered_total: number;
  delivery_records: DeliveryRecord[];
  airchecks: Aircheck[];
  issues: ReconciliationIssue[];
  makegoods: Makegood[];
  activity: ActivityEvent[];
}

export interface ImportResult {
  success: boolean;
  importedIOs: number;
  importedDeliveries: number;
  autoIssuesDetected?: number;
  errors: Array<{ row: string; data: unknown; error: string }>;
}

export interface IssueRow {
  id: string;
  campaign_id: string;
  io_number: string;
  show_title: string;
  advertiser_name: string;
  campaign_status: CampaignStatus;
  type: IssueType | string;
  severity: IssueSeverity | string;
  description: string;
  resolved: boolean;
  created_at: string;
  makegood_count: number;
}

export interface TrendPoint {
  bucket: string;
  impressions: number;
}

export interface RevenueSlice {
  advertiser: string;
  committed_value: number;
  delivered_value: number;
}

export interface ShowRow {
  id: string;
  title: string;
  category: string | null;
  created_at?: string;
  campaign_count: number;
  active_campaigns: number;
  committed_impressions: number;
  delivered_impressions: number;
  delivered_value: number;
  open_issues: number;
}

export interface PodcastRow extends ShowRow {
  rss_url: string | null;
  cover_art_url: string | null;
  network: string | null;
  host: string | null;
  description: string | null;
  website_url: string | null;
  language: string | null;
  last_synced_at: string | null;
  episode_count: number;
}

export interface AdSlot {
  id: string; episode_id: string; campaign_id: string | null; io_number?: string | null;
  advertiser_name?: string | null; slot_type: string; position_seconds: number | null;
  duration_seconds: number; status: string; expected_impressions: number;
  delivered_impressions: number; aircheck_url: string | null; notes: string | null;
}

export interface EpisodeRow {
  id: string; show_id: string; podcast_title: string; cover_art_url: string | null;
  guid: string; title: string; description: string | null; published_at: string | null;
  duration_seconds: number | null; audio_url: string | null; episode_number: number | null;
  season_number: number | null; explicit: boolean; ad_slot_count: number; ad_slots?: AdSlot[];
}

export interface IntegrationRow {
  id: string; name: string; provider: string; integration_type: "hosting" | "ad_server" | "email";
  endpoint_url: string | null; api_key_env: string | null; status: "connected" | "paused" | "error";
  last_synced_at: string | null; sync_error: string | null;
  last_run?: { status: string; records_processed: number; message: string | null; completed_at: string | null } | null;
}

export interface InvoiceRow {
  id: string; campaign_id: string; invoice_number: string; recipient_email: string | null;
  status: "draft" | "sent" | "paid" | "overdue" | "void"; amount: number;
  issued_at: string; due_at: string | null; sent_at: string | null; paid_at: string | null;
  io_number: string; podcast_title: string; advertiser_name: string;
}

export interface AlertRow {
  id: string; campaign_id: string | null; episode_id: string | null; alert_type: string;
  severity: string; title: string; message: string; status: "open" | "dismissed" | "resolved";
  due_at: string | null; created_at: string; io_number?: string | null; podcast_title?: string | null;
}

export interface OrganizationSettings {
  id: string; name: string; timezone: string; invoice_prefix: string;
  payment_terms_days: number; alert_email: string | null; automatic_alerts: boolean;
}

export interface WorkspaceUser { id: string; email: string; name: string | null; role: "admin" | "member" | "viewer"; created_at: string; }

export interface AdvertiserRow {
  id: string;
  name: string;
  contact_email: string | null;
  created_at?: string;
  campaign_count: number;
  active_campaigns: number;
  committed_impressions: number;
  delivered_impressions: number;
  delivered_value: number;
  open_issues: number;
}

export interface ReportRow {
  entity_id: string;
  name: string;
  campaign_count: number;
  active_campaigns: number;
  committed_impressions: number;
  delivered_impressions: number;
  committed_value: number;
  delivered_value: number;
  makegood_value: number;
  open_issues: number;
  previous: {
    campaign_count: number;
    delivered_impressions: number;
    delivered_value: number;
  } | null;
}

export interface ReportResponse {
  group_by: "show" | "advertiser";
  start: string;
  end: string;
  previous: { start: string; end: string };
  rows: ReportRow[];
  totals: {
    campaign_count: number;
    committed_impressions: number;
    delivered_impressions: number;
    committed_value: number;
    delivered_value: number;
    makegood_value: number;
    open_issues: number;
    previous: {
      campaign_count: number;
      delivered_impressions: number;
      delivered_value: number;
    };
  };
}

export interface AiInsights {
  insights: string;
  generated_at: string;
  model: string;
}

export interface InvoiceData {
  invoice_number: string;
  issued_at: string;
  organization: { name: string };
  advertiser: { name: string; contact_email: string | null };
  show: string;
  campaign: {
    id: string;
    io_number: string;
    status: CampaignStatus;
    start_date: string;
    end_date: string;
    committed_impressions: number;
    delivered_impressions: number;
    cpm: number;
  };
  totals: {
    committed_value: number;
    delivered_value: number;
    makegood_impressions: number;
    makegood_value: number;
    net_due: number;
  };
}

export type SortKey = "created_at" | "start_date" | "end_date" | "io_number" | "status";
export type SortDir = "asc" | "desc";
