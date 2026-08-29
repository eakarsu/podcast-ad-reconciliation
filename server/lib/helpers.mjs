// Pure helpers shared by routes and tests. No DB or network access here.

// Format an arbitrary date-ish string into a SQL DATE string (YYYY-MM-DD).
export function toSqlDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

// Variance between committed and delivered, in percent.
export function calcVariance(committed, delivered) {
  if (!committed) return 0;
  return ((delivered - committed) / committed) * 100;
}

// Determine pacing status from flight dates and delivery progress.
export function getPacingStatus(campaign, delivered, today) {
  const start = new Date(campaign.start_date);
  const end = new Date(campaign.end_date);
  const now = new Date(today);

  if (now < start) return 'not_started';
  if (now > end) return delivered >= campaign.committed_impressions ? 'on_track' : 'behind';

  const totalDays = (end - start) / (1000 * 60 * 60 * 24);
  const elapsedDays = Math.max(0, (now - start) / (1000 * 60 * 60 * 24));
  const expectedPct = totalDays > 0 ? elapsedDays / totalDays : 1;
  const actualPct = campaign.committed_impressions > 0 ? delivered / campaign.committed_impressions : 0;

  if (actualPct >= expectedPct * 0.95) return 'on_track';
  if (actualPct >= expectedPct * 0.8) return 'slight_risk';
  return 'at_risk';
}

// Percent of the flight window that has elapsed (0..1, can exceed 1 after end).
export function elapsedPct(start_date, end_date, today) {
  const start = new Date(start_date);
  const end = new Date(end_date);
  const now = new Date(today);
  const totalDays = (end - start) / (1000 * 60 * 60 * 24);
  if (totalDays <= 0) return now >= start ? 1 : 0;
  const elapsedDays = Math.max(0, (now - start) / (1000 * 60 * 60 * 24));
  return elapsedDays / totalDays;
}

// Normalize pagination params: page (1-based) and pageSize.
export function parsePagination(query, defaults = {}) {
  const maxPageSize = defaults.maxPageSize || 500;
  const defaultPageSize = defaults.pageSize || 25;
  let page = parseInt(query.page, 10);
  let pageSize = parseInt(query.pageSize, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = defaultPageSize;
  if (pageSize > maxPageSize) pageSize = maxPageSize;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

// Build the standard list response envelope.
export function paginated(rows, total, page, pageSize) {
  return {
    rows,
    total: Number(total),
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(Number(total) / pageSize)),
  };
}

// Parse a cookie header into an object (no deps).
export function parseCookies(header) {
  const out = {};
  if (!header || typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}
