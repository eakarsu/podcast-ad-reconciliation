import type {
  ActivityEvent,
  AdvertiserRow,
  AiInsights,
  AuthMe,
  CampaignDetail,
  CampaignRow,
  DeliveryRecord,
  ImportResult,
  InvoiceData,
  IssueRow,
  PodcastRow,
  EpisodeRow,
  AdSlot,
  IntegrationRow,
  InvoiceRow,
  AlertRow,
  OrganizationSettings,
  WorkspaceUser,
  Makegood,
  Paginated,
  ReportResponse,
  ReconciliationIssue,
  RevenueSlice,
  ShowRow,
  SortDir,
  SortKey,
  Summary,
  TrendPoint,
} from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4010";
const isBrowser = typeof window !== "undefined";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  const isStringBody = typeof init?.body === "string";
  if (isStringBody && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });
  if (res.status === 401 && isBrowser && !window.location.pathname.startsWith("/login")) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    throw new Error("Session expired — redirecting to login.");
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      msg = body.message || body.error || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return res.blob() as unknown as T;
  return (await res.json()) as T;
}

/* ---------------- query helpers ---------------- */

interface ListOpts {
  q?: string;
  status?: string;
  show?: string;
  start?: string;
  end?: string;
  ready?: string;
  resolved?: string;
  type?: string;
  severity?: string;
  sort?: SortKey | string;
  order?: SortDir | string;
  page?: number;
  pageSize?: number;
}

function listParams(opts: ListOpts): URLSearchParams {
  const p = new URLSearchParams();
  if (opts.q) p.set("q", opts.q);
  if (opts.status) p.set("status", opts.status);
  if (opts.show) p.set("show", opts.show);
  if (opts.start) p.set("start", opts.start);
  if (opts.end) p.set("end", opts.end);
  if (opts.ready) p.set("ready", opts.ready);
  if (opts.resolved) p.set("resolved", opts.resolved);
  if (opts.type) p.set("type", opts.type);
  if (opts.severity) p.set("severity", opts.severity);
  if (opts.sort) p.set("sort", String(opts.sort));
  if (opts.order) p.set("order", String(opts.order));
  if (opts.page && opts.page > 1) p.set("page", String(opts.page));
  if (opts.pageSize) p.set("pageSize", String(opts.pageSize));
  return p;
}

export const api = {
  /* ---- auth ---- */
  me: () => apiFetch<AuthMe>("/api/auth/me"),
  login: (email: string, password: string) =>
    apiFetch<AuthMe>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  register: (body: { name: string; email: string; password: string; organization_name: string }) =>
    apiFetch<AuthMe>("/api/auth/register", { method: "POST", body: JSON.stringify(body) }),
  logout: () => apiFetch<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),

  /* ---- dashboard ---- */
  summary: () => apiFetch<Summary>("/api/summary"),
  deliveryTrend: () => apiFetch<TrendPoint[]>("/api/analytics/delivery"),
  revenueByAdvertiser: () => apiFetch<RevenueSlice[]>("/api/analytics/revenue"),
  activity: () => apiFetch<ActivityEvent[]>("/api/activity"),
  aiInsights: () =>
    apiFetch<AiInsights>("/api/ai/insights", { method: "POST", body: JSON.stringify({}) }),
  seedSampleData: () =>
    apiFetch<{ ok: boolean; counts: { shows: number; advertisers: number; campaigns: number; issues: number; invoices: number; episodes: number; alerts: number } }>(
      "/api/demo-data",
      { method: "POST", body: JSON.stringify({}) }
    ),

  /* ---- campaigns (paginated) ---- */
  campaigns: (opts: ListOpts = {}) =>
    apiFetch<Paginated<CampaignRow>>(`/api/campaigns?${listParams(opts).toString()}`),
  campaign: (id: string) => apiFetch<CampaignDetail>(`/api/campaigns/${id}`),
  createCampaign: (body: Record<string, unknown>) =>
    apiFetch<CampaignRow>("/api/campaigns", { method: "POST", body: JSON.stringify(body) }),
  updateCampaign: (id: string, body: Record<string, unknown>) =>
    apiFetch<CampaignRow>(`/api/campaigns/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteCampaign: (id: string) => apiFetch<{ ok: boolean }>(`/api/campaigns/${id}`, { method: "DELETE" }),
  setStatus: (id: string, status: string) =>
    apiFetch<CampaignRow>(`/api/campaigns/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  createMakegood: (id: string, body: { impressions: number; issue_id: string | null }) =>
    apiFetch(`/api/campaigns/${id}/makegoods`, { method: "POST", body: JSON.stringify(body) }),
  invoice: (id: string) => apiFetch<InvoiceData>(`/api/campaigns/${id}/invoice`),

  /* ---- delivery records (manual entry) ---- */
  addDelivery: (id: string, body: { date: string; impressions: number; source?: string }) =>
    apiFetch<{ id: string; date: string; impressions_delivered: number; source: string; auto_issues_detected: number }>(
      `/api/campaigns/${id}/delivery`,
      { method: "POST", body: JSON.stringify(body) }
    ),
  deleteDelivery: (campaignId: string, recordId: string) =>
    apiFetch<{ ok: boolean }>(`/api/campaigns/${campaignId}/delivery/${recordId}`, { method: "DELETE" }),
  updateDelivery: (campaignId: string, recordId: string, body: { date: string; impressions: number; source: string }) =>
    apiFetch<DeliveryRecord>(`/api/campaigns/${campaignId}/delivery/${recordId}`, { method: "PATCH", body: JSON.stringify(body) }),
  updateMakegood: (campaignId: string, makegoodId: string, body: { impressions: number; status: string }) =>
    apiFetch<Makegood>(`/api/campaigns/${campaignId}/makegoods/${makegoodId}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteMakegood: (campaignId: string, makegoodId: string) =>
    apiFetch<{ ok: boolean }>(`/api/campaigns/${campaignId}/makegoods/${makegoodId}`, { method: "DELETE" }),

  /* ---- airchecks ---- */
  addAircheck: (id: string, body: { episode_title: string; aircheck_url: string; notes?: string }) =>
    apiFetch(`/api/campaigns/${id}/airchecks`, { method: "POST", body: JSON.stringify(body) }),
  uploadAircheck: (
    id: string,
    file: File,
    meta: { episode_title?: string; notes?: string } = {}
  ) => {
    const p = new URLSearchParams({ filename: file.name });
    if (meta.episode_title) p.set("episode_title", meta.episode_title);
    if (meta.notes) p.set("notes", meta.notes);
    return apiFetch(`/api/campaigns/${id}/airchecks/file?${p.toString()}`, {
      method: "POST",
      body: file,
      headers: { "Content-Type": "application/octet-stream" },
    });
  },
  deleteAircheck: (campaignId: string, aircheckId: string) =>
    apiFetch<{ ok: boolean }>(`/api/campaigns/${campaignId}/airchecks/${aircheckId}`, { method: "DELETE" }),

  /* ---- issues (paginated) ---- */
  issues: (opts: ListOpts = {}) =>
    apiFetch<Paginated<IssueRow>>(`/api/issues?${listParams(opts).toString()}`),
  createIssue: (body: { campaign_id: string; type: string; severity: string; description: string }) =>
    apiFetch<ReconciliationIssue>("/api/issues", { method: "POST", body: JSON.stringify(body) }),
  setIssueResolved: (id: string, resolved: boolean) =>
    apiFetch(`/api/issues/${id}`, { method: "PATCH", body: JSON.stringify({ resolved }) }),
  updateIssue: (id: string, body: { type?: string; severity?: string; description?: string }) =>
    apiFetch<ReconciliationIssue>(`/api/issues/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteIssue: (id: string) => apiFetch<{ ok: boolean }>(`/api/issues/${id}`, { method: "DELETE" }),
  detectIssues: () => apiFetch<{ created: number }>("/api/issues/detect", { method: "POST", body: JSON.stringify({}) }),

  /* ---- shows & advertisers (paginated + CRUD) ---- */
  shows: (opts: { q?: string; sort?: string; order?: string; page?: number; pageSize?: number } = {}) => {
    const p = listParams(opts);
    return apiFetch<Paginated<ShowRow>>(`/api/shows?${p.toString()}`);
  },
  createShow: (body: { title: string; category?: string }) =>
    apiFetch<ShowRow>("/api/shows", { method: "POST", body: JSON.stringify(body) }),
  updateShow: (id: string, body: { title?: string; category?: string }) =>
    apiFetch<ShowRow>(`/api/shows/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteShow: (id: string) => apiFetch<{ ok: boolean }>(`/api/shows/${id}`, { method: "DELETE" }),

  /* ---- podcasts & RSS ---- */
  podcasts: (opts: { q?: string; page?: number; pageSize?: number } = {}) =>
    apiFetch<Paginated<PodcastRow>>(`/api/podcasts?${listParams(opts).toString()}`),
  createPodcast: (body: Record<string, unknown>) => apiFetch<PodcastRow>("/api/podcasts", { method: "POST", body: JSON.stringify(body) }),
  updatePodcast: (id: string, body: Record<string, unknown>) => apiFetch<PodcastRow>(`/api/podcasts/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deletePodcast: (id: string) => apiFetch<{ ok: boolean }>(`/api/podcasts/${id}`, { method: "DELETE" }),
  importPodcastRss: (rss_url: string) => apiFetch<{ podcast: PodcastRow; episodes_synced: number }>("/api/podcasts/import-rss", { method: "POST", body: JSON.stringify({ rss_url }) }),
  syncPodcast: (id: string) => apiFetch<{ podcast: PodcastRow; episodes_synced: number }>(`/api/podcasts/${id}/sync`, { method: "POST", body: JSON.stringify({}) }),

  /* ---- episodes & inventory ---- */
  episodes: (opts: { q?: string; podcast?: string; page?: number; pageSize?: number } = {}) => {
    const p = listParams(opts); if (opts.podcast) p.set("podcast", opts.podcast);
    return apiFetch<Paginated<EpisodeRow>>(`/api/episodes?${p.toString()}`);
  },
  episode: (id: string) => apiFetch<EpisodeRow>(`/api/episodes/${id}`),
  createEpisode: (body: Record<string, unknown>) => apiFetch<EpisodeRow>("/api/episodes", { method: "POST", body: JSON.stringify(body) }),
  updateEpisode: (id: string, body: Record<string, unknown>) => apiFetch<EpisodeRow>(`/api/episodes/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteEpisode: (id: string) => apiFetch<{ ok: boolean }>(`/api/episodes/${id}`, { method: "DELETE" }),
  createAdSlot: (episodeId: string, body: Record<string, unknown>) => apiFetch<AdSlot>(`/api/episodes/${episodeId}/ad-slots`, { method: "POST", body: JSON.stringify(body) }),
  updateAdSlot: (id: string, body: Record<string, unknown>) => apiFetch<AdSlot>(`/api/ad-slots/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteAdSlot: (id: string) => apiFetch<{ ok: boolean }>(`/api/ad-slots/${id}`, { method: "DELETE" }),

  integrations: () => apiFetch<IntegrationRow[]>("/api/integrations"),
  createIntegration: (body: Record<string, unknown>) => apiFetch<IntegrationRow>("/api/integrations", { method: "POST", body: JSON.stringify(body) }),
  updateIntegration: (id: string, body: Record<string, unknown>) => apiFetch<IntegrationRow>(`/api/integrations/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteIntegration: (id: string) => apiFetch<{ ok: boolean }>(`/api/integrations/${id}`, { method: "DELETE" }),
  syncIntegration: (id: string) => apiFetch<{ ok: boolean; records_processed: number }>(`/api/integrations/${id}/sync`, { method: "POST", body: JSON.stringify({}) }),

  invoiceRecords: () => apiFetch<InvoiceRow[]>("/api/invoices"),
  generateInvoice: (campaignId: string) => apiFetch<InvoiceRow>(`/api/invoices/${campaignId}/generate`, { method: "POST", body: JSON.stringify({}) }),
  invoicePdfUrl: (id: string) => `${API_BASE}/api/invoices/${id}/pdf`,
  sendInvoice: (id: string, recipient_email?: string) => apiFetch<InvoiceRow>(`/api/invoices/${id}/send`, { method: "POST", body: JSON.stringify({ recipient_email }) }),
  updateInvoice: (id: string, body: Record<string, unknown>) => apiFetch<InvoiceRow>(`/api/invoices/${id}`, { method: "PATCH", body: JSON.stringify(body) }),

  alerts: (status?: string) => apiFetch<AlertRow[]>(`/api/alerts${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  detectAlerts: () => apiFetch<{ created: number }>("/api/alerts/detect", { method: "POST", body: JSON.stringify({}) }),
  updateAlert: (id: string, status: string) => apiFetch<AlertRow>(`/api/alerts/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),

  settings: () => apiFetch<OrganizationSettings>("/api/settings"),
  updateSettings: (body: Partial<OrganizationSettings>) => apiFetch<OrganizationSettings>("/api/settings", { method: "PATCH", body: JSON.stringify(body) }),
  users: () => apiFetch<WorkspaceUser[]>("/api/users"),
  updateUserRole: (id: string, role: string) => apiFetch<WorkspaceUser>(`/api/users/${id}/role`, { method: "PATCH", body: JSON.stringify({ role }) }),
  audit: (page = 1) => apiFetch<Paginated<ActivityEvent>>(`/api/audit?page=${page}&pageSize=50`),

  advertisers: (opts: { q?: string; sort?: string; order?: string; page?: number; pageSize?: number } = {}) => {
    const p = listParams(opts);
    return apiFetch<Paginated<AdvertiserRow>>(`/api/advertisers?${p.toString()}`);
  },
  createAdvertiser: (body: { name: string; contact_email?: string }) =>
    apiFetch<AdvertiserRow>("/api/advertisers", { method: "POST", body: JSON.stringify(body) }),
  updateAdvertiser: (id: string, body: { name?: string; contact_email?: string }) =>
    apiFetch<AdvertiserRow>(`/api/advertisers/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteAdvertiser: (id: string) => apiFetch<{ ok: boolean }>(`/api/advertisers/${id}`, { method: "DELETE" }),

  /* ---- reports ---- */
  reports: (opts: { group_by?: string; start?: string; end?: string } = {}) => {
    const p = new URLSearchParams();
    if (opts.group_by) p.set("group_by", opts.group_by);
    if (opts.start) p.set("start", opts.start);
    if (opts.end) p.set("end", opts.end);
    return apiFetch<ReportResponse>(`/api/reports?${p.toString()}`);
  },
  reportsExportUrl: (opts: { group_by?: string; start?: string; end?: string; format?: string } = {}) => {
    const p = new URLSearchParams();
    if (opts.group_by) p.set("group_by", opts.group_by);
    if (opts.start) p.set("start", opts.start);
    if (opts.end) p.set("end", opts.end);
    p.set("format", opts.format || "csv");
    return `${API_BASE}/api/reports/export?${p.toString()}`;
  },

  /* ---- import & export ---- */
  import: (payload: { ioRows: unknown[]; deliveryRows: unknown[] }) =>
    apiFetch<ImportResult>("/api/import", { method: "POST", body: JSON.stringify(payload) }),
  exportUrl: (opts: ListOpts = {}) => `${API_BASE}/api/export?${listParams(opts).toString()}`,
};

export const API_URL = API_BASE;

export async function downloadFile(url: string, filename: string): Promise<void> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error("Export failed.");
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objUrl);
}

/* ---------------- formatters ---------------- */

export function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    Number.isFinite(n) ? n : 0,
  );
}
export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(Number.isFinite(n) ? n : 0);
}
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso).slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return `${formatDate(iso)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
export function relativeTime(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "";
  const diff = Math.max(0, nowMs - t);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return formatDate(iso);
}
export function describeActivity(a: ActivityEvent): string {
  const label = a.io_number ? `IO ${a.io_number}` : a.entity_type;
  let detail = "";
  try {
    const d = typeof a.details === "string" ? JSON.parse(a.details) : a.details;
    if (d && typeof d === "object") {
      const o = d as Record<string, unknown>;
      if (o.from && o.to) detail = ` ${o.from} → ${o.to}`;
      else if (o.impressions != null)
        detail = ` · ${formatNumber(Number(o.impressions))} imps${o.value != null ? ` · ${formatCurrency(Number(o.value))}` : ""}`;
      else if (o.type) detail = ` · ${String(o.type)}`;
      else if (o.date && o.source) detail = ` · ${String(o.date)} · ${String(o.source)}`;
    }
  } catch {
    /* ignore */
  }
  return `${label}${detail}`;
}

export type { ActivityEvent, CampaignDetail, CampaignRow, ImportResult, IssueRow, Summary };
