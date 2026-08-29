import express from 'express';
import cors from 'cors';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  toSqlDate,
  calcVariance,
  getPacingStatus,
  parsePagination,
  paginated,
} from './lib/helpers.mjs';
import {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  sessionMiddleware,
  requireAuth,
  sessionCookie,
  clearSessionCookie,
} from './lib/auth.mjs';
import { detectCampaignIssues } from './lib/detection.mjs';
import { chatCompletion } from './lib/openrouter.mjs';
import { buildInsightsPrompt } from './lib/ai.mjs';
import { seedSampleWorkspace } from './lib/sample-data.mjs';
import { installFeatureRoutes, startBackgroundPodcastSync } from './features.mjs';

dotenv.config();

const PORT = process.env.API_PORT || 4010;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Error: DATABASE_URL environment variable is not set.');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.resolve(process.env.AIRCHECK_DIR || path.join(__dirname, 'uploads'));
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const COOKIE_SECURE = process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false';
const ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:3000,http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const pool = new pg.Pool({ connectionString: DATABASE_URL });
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

const app = express();

app.use(
  cors({
    origin: ORIGINS,
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(sessionMiddleware(pool));

/* ------------------------------------------------------------------ */
/*  Auth routes (public)                                               */
/* ------------------------------------------------------------------ */

// Tiny in-memory login rate limiter: 10 attempts / 15 min per email+IP.
const loginAttempts = new Map();
function loginAllowed(key) {
  const now = Date.now();
  const rec = loginAttempts.get(key);
  if (!rec || rec.resetAt <= now) {
    loginAttempts.set(key, { count: 0, resetAt: now + 15 * 60 * 1000 });
    return true;
  }
  return rec.count < 10;
}
function recordLoginFailure(key) {
  const rec = loginAttempts.get(key);
  if (rec) rec.count += 1;
}

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch {
    res.status(500).json({ status: 'error', message: 'DB connection failed' });
  }
});

app.post('/api/auth/register', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { name, email, password, organization_name } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanOrg = String(organization_name || '').trim();
    if (!cleanEmail || !/.+@.+\..+/.test(cleanEmail)) {
      return res.status(400).json({ error: 'A valid email is required' });
    }
    if (!password || String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!cleanOrg) {
      return res.status(400).json({ error: 'Organization name is required' });
    }

    await client.query('BEGIN');
    const orgRes = await client.query(
      'INSERT INTO organizations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING id, name',
      [cleanOrg]
    );
    if (orgRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Organization "${cleanOrg}" already exists` });
    }
    const org = orgRes.rows[0];

    const userRes = await client.query(
      `INSERT INTO users (organization_id, email, password_hash, name, role)
       VALUES ($1, $2, $3, $4, 'admin')
       RETURNING id, email, name, role`,
      [org.id, cleanEmail, hashPassword(password), String(name || '').trim() || null]
    ).catch((e) => {
      if (e.code === '23505') return { rows: [] , conflict: true };
      throw e;
    });
    if (userRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    const user = userRes.rows[0];
    await client.query('COMMIT');

    const { token, expiresAt } = await createSession(pool, user.id);
    res.setHeader('Set-Cookie', sessionCookie(token, expiresAt, { secure: COOKIE_SECURE }));
    res.status(201).json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      organization: { id: org.id, name: org.name },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const key = `${cleanEmail}|${req.ip || 'unknown'}`;
    if (!loginAllowed(key)) {
      return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    }

    const userRes = await pool.query(
      `SELECT u.id, u.email, u.name, u.role, u.password_hash, o.id AS org_id, o.name AS org_name
       FROM users u JOIN organizations o ON o.id = u.organization_id
       WHERE lower(u.email) = $1`,
      [cleanEmail]
    );
    const user = userRes.rows[0];
    if (!user || !verifyPassword(password || '', user.password_hash)) {
      recordLoginFailure(key);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const { token, expiresAt } = await createSession(pool, user.id);
    res.setHeader('Set-Cookie', sessionCookie(token, expiresAt, { secure: COOKIE_SECURE }));
    res.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      organization: { id: user.org_id, name: user.org_name },
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/*  Auth gate: everything below requires a valid session               */
/* ------------------------------------------------------------------ */

app.use('/api', requireAuth);

app.use('/uploads', requireAuth, express.static(UPLOAD_DIR));

app.get('/api/auth/me', (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
      role: req.user.role,
    },
    organization: { id: req.user.organization_id, name: req.user.organization_name },
  });
});

app.post('/api/auth/logout', async (req, res, next) => {
  try {
    await destroySession(pool, req.sessionToken);
    res.setHeader('Set-Cookie', clearSessionCookie({ secure: COOKIE_SECURE }));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Viewers can inspect the workspace but cannot mutate operational records.
app.use('/api', (req, res, next) => {
  if (req.user?.role === 'viewer' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return res.status(403).json({ error: 'Viewer access is read-only.' });
  }
  next();
});

app.post('/api/demo-data', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const counts = await seedSampleWorkspace(client, req.orgId);
    await client.query('COMMIT');
    res.status(201).json({ ok: true, counts });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

/* ------------------------------------------------------------------ */
/*  Shared helpers                                                     */
/* ------------------------------------------------------------------ */

function buildCampaignFilters(query, orgId) {
  const { q, status, show, start, end, ready } = query;
  const where = ['c.organization_id = $1'];
  const params = [orgId];
  let idx = 2;

  if (q) {
    where.push(`(c.io_number ILIKE $${idx} OR a.name ILIKE $${idx} OR s.title ILIKE $${idx})`);
    params.push(`%${q}%`);
    idx++;
  }
  if (status) {
    where.push(`c.status = $${idx}`);
    params.push(status);
    idx++;
  }
  if (show) {
    where.push(`s.title = $${idx}`);
    params.push(show);
    idx++;
  }
  if (start) {
    where.push(`c.end_date >= $${idx}`);
    params.push(toSqlDate(start));
    idx++;
  }
  if (end) {
    where.push(`c.start_date <= $${idx}`);
    params.push(toSqlDate(end));
    idx++;
  }
  let having = '';
  if (ready === 'true' || ready === 'false') {
    // invoice-ready = completed with no open issues; blocked = completed with open issues
    where.push(`c.status = 'completed'`);
    having =
      ready === 'true'
        ? 'HAVING COUNT(DISTINCT ri.id) FILTER (WHERE ri.resolved = false) = 0'
        : 'HAVING COUNT(DISTINCT ri.id) FILTER (WHERE ri.resolved = false) > 0';
  }
  return { whereSql: where.join(' AND '), params, havingSql: having };
}

const CAMPAIGN_SORTS = {
  created_at: 'c.created_at',
  start_date: 'c.start_date',
  end_date: 'c.end_date',
  io_number: 'c.io_number',
  status: 'c.status',
  committed_impressions: 'committed_impressions',
  delivered_impressions: 'delivered_impressions',
};

function toCampaignRow(row, today) {
  const delivered = Number(row.delivered_impressions) || 0;
  return {
    ...row,
    committed_impressions: Number(row.committed_impressions),
    delivered_impressions: delivered,
    cpm: Number(row.cpm),
    makegood_amount: Number(row.makegood_amount || 0),
    variance_percent: parseFloat(calcVariance(Number(row.committed_impressions), delivered).toFixed(2)),
    pacing_status: getPacingStatus(
      { start_date: row.start_date, end_date: row.end_date, committed_impressions: Number(row.committed_impressions) },
      delivered,
      today
    ),
    invoice_ready:
      row.status === 'completed' && Number(row.open_issue_count) === 0,
  };
}

// Run auto issue detection for an org (optionally one campaign).
// Uses deterministic descriptions so repeated sweeps de-duplicate.
async function runAutoDetection(client, orgId, campaignId = null) {
  const res = await client.query(
    `SELECT c.id, c.status, c.start_date, c.end_date, c.committed_impressions,
       COALESCE((SELECT SUM(impressions_delivered) FROM delivery_records dr WHERE dr.campaign_id = c.id), 0) AS delivered,
       (SELECT COUNT(*) FROM airchecks a WHERE a.campaign_id = c.id) AS aircheck_count
     FROM campaigns c
     WHERE c.organization_id = $1 AND c.status IN ('active', 'completed') ${campaignId ? 'AND c.id = $2' : ''}`,
    campaignId ? [orgId, campaignId] : [orgId]
  );
  const today = new Date().toISOString();
  let created = 0;
  for (const row of res.rows) {
    const issues = detectCampaignIssues(
      { id: row.id, status: row.status, start_date: row.start_date, end_date: row.end_date, committed_impressions: Number(row.committed_impressions) },
      Number(row.delivered),
      Number(row.aircheck_count),
      today
    );
    for (const issue of issues) {
      const ins = await client.query(
        `INSERT INTO reconciliation_issues (campaign_id, type, severity, description)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (campaign_id, type, description) DO NOTHING
         RETURNING id`,
        [row.id, issue.type, issue.severity, issue.description]
      );
      if (ins.rows.length) {
        created++;
        await client.query(
          `INSERT INTO activity_events (organization_id, entity_type, entity_id, action, details)
           VALUES ($1, 'issue', $2, 'auto_detected', $3)`,
          [orgId, ins.rows[0].id, JSON.stringify({ type: issue.type, severity: issue.severity })]
        );
      }
    }
  }
  return created;
}

function csvEscape(v) {
  if (v == null) return '""';
  return `"${String(v).replace(/"/g, '""')}"`;
}

/* ------------------------------------------------------------------ */
/*  Campaigns                                                          */
/* ------------------------------------------------------------------ */

app.get('/api/campaigns', async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const { sort = 'created_at', order = 'desc' } = req.query;
    const { page, pageSize, offset } = parsePagination(req.query);
    const { whereSql, params, havingSql } = buildCampaignFilters(req.query, orgId);

    const safeSort = CAMPAIGN_SORTS[sort] || CAMPAIGN_SORTS.created_at;
    const safeOrder = String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const sql = `
      SELECT
        c.id, c.io_number, c.status, c.start_date, c.end_date,
        c.committed_impressions, c.cpm, c.created_at, c.updated_at,
        s.title as show_title,
        a.name as advertiser_name,
        COALESCE(SUM(dr.impressions_delivered), 0) as delivered_impressions,
        COUNT(DISTINCT ri.id) FILTER (WHERE ri.resolved = false) as open_issue_count,
        COALESCE(SUM(mg.value), 0) as makegood_amount,
        COUNT(*) OVER()::int as total_count
      FROM campaigns c
      JOIN shows s ON c.show_id = s.id
      JOIN advertisers a ON c.advertiser_id = a.id
      LEFT JOIN delivery_records dr ON c.id = dr.campaign_id
      LEFT JOIN reconciliation_issues ri ON c.id = ri.campaign_id
      LEFT JOIN makegoods mg ON c.id = mg.campaign_id AND mg.status = 'approved'
      WHERE ${whereSql}
      GROUP BY c.id, s.title, a.name
      ${havingSql}
      ORDER BY ${safeSort} ${safeOrder}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const result = await pool.query(sql, [...params, pageSize, offset]);
    const today = new Date().toISOString();
    const total = result.rows.length ? Number(result.rows[0].total_count) : 0;
    res.json(paginated(result.rows.map((r) => toCampaignRow(r, today)), total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

app.get('/api/campaigns/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;

    const campaignRes = await pool.query(
      `SELECT c.*, s.title as show_title, a.name as advertiser_name
       FROM campaigns c
       JOIN shows s ON c.show_id = s.id
       JOIN advertisers a ON c.advertiser_id = a.id
       WHERE c.id = $1 AND c.organization_id = $2`,
      [id, orgId]
    );
    if (campaignRes.rows.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaign = campaignRes.rows[0];

    const [deliveryRes, aircheckRes, issueRes, makegoodRes, activityRes] = await Promise.all([
      pool.query('SELECT * FROM delivery_records WHERE campaign_id = $1 ORDER BY date ASC', [id]),
      pool.query('SELECT * FROM airchecks WHERE campaign_id = $1 ORDER BY verified_at DESC', [id]),
      pool.query('SELECT * FROM reconciliation_issues WHERE campaign_id = $1 ORDER BY created_at DESC', [id]),
      pool.query('SELECT * FROM makegoods WHERE campaign_id = $1 ORDER BY created_at DESC', [id]),
      pool.query('SELECT * FROM activity_events WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 20', [id]),
    ]);

    const deliveredTotal = deliveryRes.rows.reduce((sum, r) => sum + Number(r.impressions_delivered), 0);

    res.json({
      ...campaign,
      committed_impressions: Number(campaign.committed_impressions),
      cpm: Number(campaign.cpm),
      delivered_total: deliveredTotal,
      variance_percent: parseFloat(calcVariance(Number(campaign.committed_impressions), deliveredTotal).toFixed(2)),
      pacing_status: getPacingStatus(
        { start_date: campaign.start_date, end_date: campaign.end_date, committed_impressions: Number(campaign.committed_impressions) },
        deliveredTotal,
        new Date().toISOString()
      ),
      delivery_records: deliveryRes.rows.map((r) => ({ ...r, impressions_delivered: Number(r.impressions_delivered) })),
      airchecks: aircheckRes.rows,
      issues: issueRes.rows,
      makegoods: makegoodRes.rows,
      activity: activityRes.rows,
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/campaigns', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { io_number, show_title, advertiser_name, advertiser_email, status, start_date, end_date, committed_impressions, cpm } = req.body;
    const orgId = req.orgId;

    if (!io_number || !show_title || !advertiser_name || !start_date || !end_date) {
      return res.status(400).json({ error: 'IO number, show, advertiser, and dates are required' });
    }
    if (committed_impressions == null || Number(committed_impressions) <= 0) {
      return res.status(400).json({ error: 'Committed impressions must be a positive number' });
    }
    if (cpm == null || Number(cpm) <= 0) {
      return res.status(400).json({ error: 'CPM must be a positive number' });
    }
    const startSql = toSqlDate(start_date);
    const endSql = toSqlDate(end_date);
    if (!startSql || !endSql) {
      return res.status(400).json({ error: 'Invalid start or end date' });
    }
    if (endSql < startSql) {
      return res.status(400).json({ error: 'End date must be on or after the start date' });
    }
    const validStatuses = ['draft', 'active', 'paused', 'completed', 'cancelled'];
    const initialStatus = validStatuses.includes(status) ? status : 'draft';

    await client.query('BEGIN');

    const showRes = await client.query(
      `INSERT INTO shows (organization_id, title, category)
       VALUES ($1, $2, 'General')
       ON CONFLICT (organization_id, title) DO UPDATE SET title = EXCLUDED.title
       RETURNING id`,
      [orgId, show_title.trim()]
    );
    const advRes = await client.query(
      `INSERT INTO advertisers (organization_id, name, contact_email)
       VALUES ($1, $2, $3)
       ON CONFLICT (organization_id, name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [orgId, advertiser_name.trim(), advertiser_email || null]
    );
    const insertRes = await client.query(
      `INSERT INTO campaigns (organization_id, show_id, advertiser_id, io_number, status, start_date, end_date, committed_impressions, cpm)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (organization_id, io_number) DO NOTHING
       RETURNING *`,
      [orgId, showRes.rows[0].id, advRes.rows[0].id, String(io_number).trim(), initialStatus, startSql, endSql, Math.round(Number(committed_impressions)), Number(cpm)]
    );
    if (insertRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `IO number "${io_number}" already exists` });
    }

    await client.query(
      `INSERT INTO activity_events (organization_id, entity_type, entity_id, action, details)
       VALUES ($1, 'campaign', $2, 'created', $3)`,
      [orgId, insertRes.rows[0].id, JSON.stringify({ io_number, committed_impressions, cpm })]
    );

    await client.query('COMMIT');
    res.status(201).json(insertRes.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

app.patch('/api/campaigns/:id', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const orgId = req.orgId;
    const { start_date, end_date, committed_impressions, cpm, show_title, advertiser_name, advertiser_email } = req.body;

    await client.query('BEGIN');

    const campRes = await client.query('SELECT * FROM campaigns WHERE id = $1 AND organization_id = $2 FOR UPDATE', [id, orgId]);
    if (campRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaign = campRes.rows[0];

    const updates = [];
    const params = [];
    const add = (col, val) => {
      params.push(val);
      updates.push(`${col} = $${params.length}`);
    };

    let startSql = campaign.start_date;
    let endSql = campaign.end_date;
    if (start_date != null) {
      startSql = toSqlDate(start_date);
      if (!startSql) throw new Error('Invalid start date');
      add('start_date', startSql);
    }
    if (end_date != null) {
      endSql = toSqlDate(end_date);
      if (!endSql) throw new Error('Invalid end date');
      add('end_date', endSql);
    }
    if (endSql < startSql) throw new Error('End date must be on or after the start date');
    if (committed_impressions != null) {
      if (Number(committed_impressions) <= 0) throw new Error('Committed impressions must be a positive number');
      add('committed_impressions', Math.round(Number(committed_impressions)));
    }
    if (cpm != null) {
      if (Number(cpm) <= 0) throw new Error('CPM must be a positive number');
      add('cpm', Number(cpm));
    }
    if (show_title != null && show_title.trim()) {
      const showRes = await client.query(
        `INSERT INTO shows (organization_id, title, category)
         VALUES ($1, $2, 'General')
         ON CONFLICT (organization_id, title) DO UPDATE SET title = EXCLUDED.title
         RETURNING id`,
        [campaign.organization_id, show_title.trim()]
      );
      add('show_id', showRes.rows[0].id);
    }
    if (advertiser_name != null && advertiser_name.trim()) {
      const advRes = await client.query(
        `INSERT INTO advertisers (organization_id, name, contact_email)
         VALUES ($1, $2, $3)
         ON CONFLICT (organization_id, name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [campaign.organization_id, advertiser_name.trim(), advertiser_email || null]
      );
      add('advertiser_id', advRes.rows[0].id);
    }

    if (updates.length > 0) {
      params.push(id);
      await client.query(`UPDATE campaigns SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`, params);
      await client.query(
        `INSERT INTO activity_events (organization_id, entity_type, entity_id, action, details)
         VALUES ($1, 'campaign', $2, 'updated', $3)`,
        [campaign.organization_id, id, JSON.stringify({ fields: updates.map((u) => u.split(' ')[0]) })]
      );
    }

    await client.query('COMMIT');

    const updated = await pool.query(
      `SELECT c.*, s.title as show_title, a.name as advertiser_name
       FROM campaigns c JOIN shows s ON c.show_id = s.id JOIN advertisers a ON c.advertiser_id = a.id
       WHERE c.id = $1`,
      [id]
    );
    res.json(updated.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.message && /Invalid|must be|required|date/i.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  } finally {
    client.release();
  }
});

app.delete('/api/campaigns/:id', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const orgId = req.orgId;
    await client.query('BEGIN');
    const campaignRes = await client.query(
      'DELETE FROM campaigns WHERE id = $1 AND organization_id = $2 RETURNING io_number',
      [id, orgId]
    );
    if (campaignRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Campaign not found' });
    }
    await client.query(
      `INSERT INTO activity_events (organization_id, entity_type, entity_id, action, details)
       VALUES ($1, 'campaign', $2, 'deleted', $3)`,
      [orgId, id, JSON.stringify({ io_number: campaignRes.rows[0].io_number })]
    );
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

app.patch('/api/campaigns/:id/status', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const orgId = req.orgId;
    const { status } = req.body;

    const validTransitions = {
      draft: ['active', 'cancelled'],
      active: ['paused', 'completed', 'cancelled'],
      paused: ['active', 'cancelled'],
      completed: [],
      cancelled: [],
    };

    const currentRes = await client.query('SELECT status FROM campaigns WHERE id = $1 AND organization_id = $2', [id, orgId]);
    if (currentRes.rows.length === 0) return res.status(404).json({ error: 'Campaign not found' });

    const currentStatus = currentRes.rows[0].status;
    if (!validTransitions[currentStatus]?.includes(status)) {
      return res.status(400).json({ error: `Invalid transition from ${currentStatus} to ${status}` });
    }

    await client.query('BEGIN');
    await client.query('UPDATE campaigns SET status = $1, updated_at = NOW() WHERE id = $2', [status, id]);
    await client.query(
      `INSERT INTO activity_events (organization_id, entity_type, entity_id, action, details)
       VALUES ($1, 'campaign', $2, 'status_changed', $3)`,
      [orgId, id, JSON.stringify({ from: currentStatus, to: status })]
    );
    await client.query('COMMIT');

    const updatedRes = await client.query('SELECT * FROM campaigns WHERE id = $1', [id]);
    res.json(updatedRes.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

app.post('/api/campaigns/:id/makegoods', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const orgId = req.orgId;
    const { impressions, issue_id } = req.body;

    if (!impressions || impressions <= 0) {
      return res.status(400).json({ error: 'Valid impressions required' });
    }

    await client.query('BEGIN');

    const campRes = await client.query(
      'SELECT c.*, s.title FROM campaigns c JOIN shows s ON c.show_id = s.id WHERE c.id = $1 AND c.organization_id = $2 FOR UPDATE',
      [id, orgId]
    );
    if (campRes.rows.length === 0) throw new Error('Campaign not found');

    const campaign = campRes.rows[0];
    const deliveredRes = await client.query(
      'SELECT COALESCE(SUM(impressions_delivered), 0) as total FROM delivery_records WHERE campaign_id = $1',
      [id]
    );
    const delivered = parseInt(deliveredRes.rows[0].total, 10);

    const remaining = campaign.committed_impressions - delivered;
    if (remaining <= 0) {
      throw new Error('Campaign fully delivered, no makegoods needed');
    }

    const granted = Math.min(impressions, remaining);
    const value = (granted * campaign.cpm) / 1000;

    const mgRes = await client.query(
      `INSERT INTO makegoods (campaign_id, issue_id, impressions_granted, value, status)
       VALUES ($1, $2, $3, $4, 'approved')
       RETURNING *`,
      [id, issue_id || null, granted, value]
    );

    await client.query(
      `INSERT INTO activity_events (organization_id, entity_type, entity_id, action, details)
       VALUES ($1, 'makegood', $2, 'created', $3)`,
      [campaign.organization_id, mgRes.rows[0].id, JSON.stringify({ impressions: granted, value })]
    );

    await client.query('COMMIT');

    const finalCamp = await client.query('SELECT * FROM campaigns WHERE id = $1', [id]);
    res.json(finalCamp.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.message === 'Campaign not found') return res.status(404).json({ error: err.message });
    if (err.message && /fully delivered/i.test(err.message)) return res.status(400).json({ error: err.message });
    next(err);
  } finally {
    client.release();
  }
});

app.patch('/api/campaigns/:id/makegoods/:makegoodId', async (req, res, next) => {
  try {
    const { id, makegoodId } = req.params;
    const orgId = req.orgId;
    const { impressions, status } = req.body;
    const validStatuses = ['pending', 'approved', 'delivered'];
    const updates = [];
    const params = [];
    if (impressions != null) {
      const imp = Math.round(Number(impressions));
      if (!Number.isFinite(imp) || imp <= 0) return res.status(400).json({ error: 'Impressions must be a positive number' });
      params.push(imp);
      updates.push(`impressions_granted = $${params.length}`);
      params.push(imp);
      updates.push(`value = ($${params.length} * c.cpm / 1000.0)`);
    }
    if (status != null) {
      if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid makegood status' });
      params.push(status);
      updates.push(`status = $${params.length}`);
    }
    if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });
    params.push(makegoodId, id, orgId);
    const updateRes = await pool.query(
      `UPDATE makegoods mg SET ${updates.join(', ')}
       FROM campaigns c
       WHERE mg.campaign_id = c.id
         AND mg.id = $${params.length - 2}
         AND c.id = $${params.length - 1}
         AND c.organization_id = $${params.length}
       RETURNING mg.*`,
      params
    );
    if (updateRes.rows.length === 0) return res.status(404).json({ error: 'Makegood not found' });
    res.json({ ...updateRes.rows[0], impressions_granted: Number(updateRes.rows[0].impressions_granted), value: Number(updateRes.rows[0].value) });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/campaigns/:id/makegoods/:makegoodId', async (req, res, next) => {
  try {
    const { id, makegoodId } = req.params;
    const orgId = req.orgId;
    const deleteRes = await pool.query(
      `DELETE FROM makegoods mg
       USING campaigns c
       WHERE mg.campaign_id = c.id AND mg.id = $1 AND c.id = $2 AND c.organization_id = $3
       RETURNING mg.id`,
      [makegoodId, id, orgId]
    );
    if (deleteRes.rows.length === 0) return res.status(404).json({ error: 'Makegood not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.get('/api/campaigns/:id/invoice', async (req, res, next) => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;
    const result = await pool.query(
      `SELECT c.id, c.io_number, c.status, c.start_date, c.end_date, c.committed_impressions, c.cpm,
        s.title AS show_title,
        a.name AS advertiser_name, a.contact_email,
        (SELECT name FROM organizations WHERE id = c.organization_id) AS org_name,
        (SELECT COALESCE(SUM(impressions_delivered), 0) FROM delivery_records WHERE campaign_id = c.id) AS delivered_impressions,
        (SELECT COALESCE(SUM(impressions_granted), 0) FROM makegoods WHERE campaign_id = c.id AND status = 'approved') AS makegood_impressions,
        (SELECT COALESCE(SUM(value), 0) FROM makegoods WHERE campaign_id = c.id AND status = 'approved') AS makegood_value
       FROM campaigns c
       JOIN shows s ON c.show_id = s.id
       JOIN advertisers a ON c.advertiser_id = a.id
       WHERE c.id = $1 AND c.organization_id = $2`,
      [id, orgId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const r = result.rows[0];
    const committedValue = (Number(r.committed_impressions) * Number(r.cpm)) / 1000;
    const deliveredValue = (Number(r.delivered_impressions) * Number(r.cpm)) / 1000;
    const makegoodValue = Number(r.makegood_value || 0);

    res.json({
      invoice_number: r.io_number,
      issued_at: new Date().toISOString(),
      organization: { name: r.org_name || 'SignalLedger' },
      advertiser: { name: r.advertiser_name, contact_email: r.contact_email },
      show: r.show_title,
      campaign: {
        id: r.id,
        io_number: r.io_number,
        status: r.status,
        start_date: r.start_date,
        end_date: r.end_date,
        committed_impressions: Number(r.committed_impressions),
        delivered_impressions: Number(r.delivered_impressions),
        cpm: Number(r.cpm),
      },
      totals: {
        committed_value: parseFloat(committedValue.toFixed(2)),
        delivered_value: parseFloat(deliveredValue.toFixed(2)),
        makegood_impressions: Number(r.makegood_impressions || 0),
        makegood_value: parseFloat(makegoodValue.toFixed(2)),
        net_due: parseFloat(Math.max(0, deliveredValue - makegoodValue).toFixed(2)),
      },
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/*  Delivery records (manual entry)                                    */
/* ------------------------------------------------------------------ */

const DELIVERY_SOURCES = ['manual', 'ad_server', 'api', 'import'];

app.post('/api/campaigns/:id/delivery', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const orgId = req.orgId;
    const { date, impressions, source } = req.body;

    const dateSql = toSqlDate(date);
    if (!dateSql) return res.status(400).json({ error: 'A valid date is required' });
    const imp = Math.round(Number(impressions));
    if (!Number.isFinite(imp) || imp < 0) {
      return res.status(400).json({ error: 'Impressions must be a non-negative number' });
    }
    const src = DELIVERY_SOURCES.includes(source) ? source : 'manual';

    await client.query('BEGIN');

    const campRes = await client.query('SELECT id, io_number FROM campaigns WHERE id = $1 AND organization_id = $2', [id, orgId]);
    if (campRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const recRes = await client.query(
      `INSERT INTO delivery_records (campaign_id, date, impressions_delivered, source)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (campaign_id, date, source) DO UPDATE SET impressions_delivered = EXCLUDED.impressions_delivered
       RETURNING *`,
      [id, dateSql, imp, src]
    );

    await client.query(
      `INSERT INTO activity_events (organization_id, entity_type, entity_id, action, details)
       VALUES ($1, 'campaign', $2, 'delivery_logged', $3)`,
      [orgId, id, JSON.stringify({ date: dateSql, impressions: imp, source: src })]
    );

    const detected = await runAutoDetection(client, orgId, id);

    await client.query('COMMIT');
    res.status(201).json({ ...recRes.rows[0], impressions_delivered: Number(recRes.rows[0].impressions_delivered), auto_issues_detected: detected });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

app.patch('/api/campaigns/:id/delivery/:recordId', async (req, res, next) => {
  try {
    const { id, recordId } = req.params;
    const orgId = req.orgId;
    const { date, impressions, source } = req.body;
    const updates = [];
    const params = [];
    if (date != null) {
      const dateSql = toSqlDate(date);
      if (!dateSql) return res.status(400).json({ error: 'A valid date is required' });
      params.push(dateSql);
      updates.push(`date = $${params.length}`);
    }
    if (impressions != null) {
      const imp = Math.round(Number(impressions));
      if (!Number.isFinite(imp) || imp < 0) return res.status(400).json({ error: 'Impressions must be a non-negative number' });
      params.push(imp);
      updates.push(`impressions_delivered = $${params.length}`);
    }
    if (source != null) {
      if (!DELIVERY_SOURCES.includes(source)) return res.status(400).json({ error: 'Invalid delivery source' });
      params.push(source);
      updates.push(`source = $${params.length}`);
    }
    if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });
    params.push(recordId, id, orgId);
    const updateRes = await pool.query(
      `UPDATE delivery_records dr SET ${updates.join(', ')}
       FROM campaigns c
       WHERE dr.campaign_id = c.id
         AND dr.id = $${params.length - 2}
         AND c.id = $${params.length - 1}
         AND c.organization_id = $${params.length}
       RETURNING dr.*`,
      params
    );
    if (updateRes.rows.length === 0) return res.status(404).json({ error: 'Delivery record not found' });
    res.json({ ...updateRes.rows[0], impressions_delivered: Number(updateRes.rows[0].impressions_delivered) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A delivery record already exists for that date and source' });
    next(err);
  }
});

app.delete('/api/campaigns/:id/delivery/:recordId', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id, recordId } = req.params;
    const orgId = req.orgId;

    await client.query('BEGIN');
    const campRes = await client.query('SELECT id FROM campaigns WHERE id = $1 AND organization_id = $2', [id, orgId]);
    if (campRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const delRes = await client.query('DELETE FROM delivery_records WHERE id = $1 AND campaign_id = $2 RETURNING id', [recordId, id]);
    if (delRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Delivery record not found' });
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

/* ------------------------------------------------------------------ */
/*  Airchecks (URL entry + file upload)                                */
/* ------------------------------------------------------------------ */

app.post('/api/campaigns/:id/airchecks', async (req, res, next) => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;
    const { episode_title, aircheck_url, notes } = req.body;

    const title = String(episode_title || '').trim();
    const url = String(aircheck_url || '').trim();
    if (!title) return res.status(400).json({ error: 'Episode title is required' });
    if (!url) return res.status(400).json({ error: 'Aircheck URL is required (use the upload endpoint for files)' });

    const campRes = await pool.query('SELECT id FROM campaigns WHERE id = $1 AND organization_id = $2', [id, orgId]);
    if (campRes.rows.length === 0) return res.status(404).json({ error: 'Campaign not found' });

    const insRes = await pool.query(
      `INSERT INTO airchecks (campaign_id, episode_title, aircheck_url, notes)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, title, url, notes || null]
    ).catch((e) => {
      if (e.code === '23505') return { rows: [], conflict: true };
      throw e;
    });
    if (insRes.rows.length === 0) {
      return res.status(409).json({ error: 'An aircheck with this episode title already exists for the campaign' });
    }
    res.status(201).json(insRes.rows[0]);
  } catch (err) {
    next(err);
  }
});

app.post(
  '/api/campaigns/:id/airchecks/file',
  express.raw({ type: () => true, limit: '80mb' }),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const orgId = req.orgId;
      const filename = path.basename(String(req.query.filename || 'aircheck'));
      const title = String(req.query.episode_title || filename).trim() || 'Untitled aircheck';
      const notes = req.query.notes ? String(req.query.notes).slice(0, 2000) : null;

      if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: 'Empty upload — send the file as the raw request body' });
      }

      const campRes = await pool.query('SELECT id FROM campaigns WHERE id = $1 AND organization_id = $2', [id, orgId]);
      if (campRes.rows.length === 0) return res.status(404).json({ error: 'Campaign not found' });

      const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'aircheck';
      const storedName = `${crypto.randomUUID()}-${safeName}`;
      const relDir = id;
      const absDir = path.join(UPLOAD_DIR, relDir);
      await fs.promises.mkdir(absDir, { recursive: true });
      await fs.promises.writeFile(path.join(absDir, storedName), req.body);

      const insRes = await pool.query(
        `INSERT INTO airchecks (campaign_id, episode_title, aircheck_url, notes)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [id, title, `/uploads/${relDir}/${storedName}`, notes]
      ).catch((e) => {
        if (e.code === '23505') return { rows: [], conflict: true };
        throw e;
      });
      if (insRes.rows.length === 0) {
        return res.status(409).json({ error: 'An aircheck with this episode title already exists for the campaign' });
      }
      res.status(201).json(insRes.rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

app.delete('/api/campaigns/:id/airchecks/:aircheckId', async (req, res, next) => {
  try {
    const { id, aircheckId } = req.params;
    const orgId = req.orgId;

    const campRes = await pool.query('SELECT id FROM campaigns WHERE id = $1 AND organization_id = $2', [id, orgId]);
    if (campRes.rows.length === 0) return res.status(404).json({ error: 'Campaign not found' });

    const delRes = await pool.query('DELETE FROM airchecks WHERE id = $1 AND campaign_id = $2 RETURNING aircheck_url', [aircheckId, id]);
    if (delRes.rows.length === 0) return res.status(404).json({ error: 'Aircheck not found' });

    const url = delRes.rows[0].aircheck_url || '';
    if (url.startsWith('/uploads/')) {
      const abs = path.join(UPLOAD_DIR, path.normalize(url.replace('/uploads/', '')));
      if (abs.startsWith(UPLOAD_DIR)) {
        await fs.promises.unlink(abs).catch(() => {});
      }
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/*  Reconciliation issues                                              */
/* ------------------------------------------------------------------ */

app.get('/api/issues', async (req, res, next) => {
  try {
    const { resolved, type, severity, q } = req.query;
    const orgId = req.orgId;
    const { page, pageSize, offset } = parsePagination(req.query);

    const where = ['c.organization_id = $1'];
    const params = [orgId];
    let idx = 2;
    if (resolved === 'true' || resolved === 'false') {
      where.push(`ri.resolved = $${idx}`);
      params.push(resolved === 'true');
      idx++;
    }
    if (type) {
      where.push(`ri.type = $${idx}`);
      params.push(type);
      idx++;
    }
    if (severity) {
      where.push(`ri.severity = $${idx}`);
      params.push(severity);
      idx++;
    }
    if (q) {
      where.push(`(ri.description ILIKE $${idx} OR c.io_number ILIKE $${idx} OR a.name ILIKE $${idx} OR s.title ILIKE $${idx})`);
      params.push(`%${q}%`);
      idx++;
    }

    const sql = `
      SELECT ri.id, ri.campaign_id, ri.type, ri.severity, ri.description, ri.resolved, ri.created_at,
        c.io_number, c.status AS campaign_status,
        s.title AS show_title, a.name AS advertiser_name,
        (SELECT COUNT(*) FROM makegoods mg WHERE mg.issue_id = ri.id) AS makegood_count,
        COUNT(*) OVER()::int AS total_count
      FROM reconciliation_issues ri
      JOIN campaigns c ON c.id = ri.campaign_id
      JOIN shows s ON s.id = c.show_id
      JOIN advertisers a ON a.id = c.advertiser_id
      WHERE ${where.join(' AND ')}
      ORDER BY ri.resolved ASC,
        CASE ri.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
        ri.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `;
    const result = await pool.query(sql, [...params, pageSize, offset]);
    const total = result.rows.length ? Number(result.rows[0].total_count) : 0;
    res.json(paginated(result.rows, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

app.post('/api/issues', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { campaign_id, type, severity, description } = req.body;
    const validTypes = ['under_delivery', 'over_delivery', 'missing_aircheck', 'discrepancy'];
    const validSeverities = ['low', 'medium', 'high'];
    const orgId = req.orgId;

    if (!campaign_id) return res.status(400).json({ error: 'Campaign is required' });
    if (!validTypes.includes(type)) return res.status(400).json({ error: 'Invalid issue type' });
    if (!validSeverities.includes(severity)) return res.status(400).json({ error: 'Invalid severity' });
    if (!description || !description.trim()) return res.status(400).json({ error: 'Description is required' });

    await client.query('BEGIN');

    const campRes = await client.query('SELECT id, organization_id FROM campaigns WHERE id = $1 AND organization_id = $2', [campaign_id, orgId]);
    if (campRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const insertRes = await client.query(
      `INSERT INTO reconciliation_issues (campaign_id, type, severity, description)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [campaign_id, type, severity, description.trim()]
    );

    await client.query(
      `INSERT INTO activity_events (organization_id, entity_type, entity_id, action, details)
       VALUES ($1, 'issue', $2, 'created', $3)`,
      [campRes.rows[0].organization_id, insertRes.rows[0].id, JSON.stringify({ type, severity })]
    );

    await client.query('COMMIT');
    res.status(201).json(insertRes.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An identical issue already exists for this campaign' });
    }
    next(err);
  } finally {
    client.release();
  }
});

app.patch('/api/issues/:id', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { resolved, type, severity, description } = req.body;
    const orgId = req.orgId;
    const validTypes = ['under_delivery', 'over_delivery', 'missing_aircheck', 'discrepancy'];
    const validSeverities = ['low', 'medium', 'high'];
    const updates = [];
    const params = [];
    const add = (column, value) => {
      params.push(value);
      updates.push(`${column} = $${params.length}`);
    };
    if (resolved != null) {
      if (typeof resolved !== 'boolean') return res.status(400).json({ error: 'Resolved must be true or false' });
      add('resolved', resolved);
    }
    if (type != null) {
      if (!validTypes.includes(type)) return res.status(400).json({ error: 'Invalid issue type' });
      add('type', type);
    }
    if (severity != null) {
      if (!validSeverities.includes(severity)) return res.status(400).json({ error: 'Invalid severity' });
      add('severity', severity);
    }
    if (description != null) {
      const cleanDescription = String(description).trim();
      if (!cleanDescription) return res.status(400).json({ error: 'Description is required' });
      add('description', cleanDescription);
    }
    if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    await client.query('BEGIN');

    const issueRes = await client.query(
      `SELECT ri.id, c.organization_id FROM reconciliation_issues ri
       JOIN campaigns c ON c.id = ri.campaign_id
       WHERE ri.id = $1 AND c.organization_id = $2`,
      [id, orgId]
    );
    if (issueRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Issue not found' });
    }

    params.push(id);
    const updateRes = await client.query(
      `UPDATE reconciliation_issues SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );

    await client.query(
      `INSERT INTO activity_events (organization_id, entity_type, entity_id, action, details)
       VALUES ($1, 'issue', $2, $3, $4)`,
      [
        issueRes.rows[0].organization_id,
        id,
        typeof resolved === 'boolean' && updates.length === 1 ? (resolved ? 'resolved' : 'reopened') : 'updated',
        JSON.stringify({ fields: updates.map((update) => update.split(' ')[0]) }),
      ]
    );

    await client.query('COMMIT');
    res.json(updateRes.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

app.delete('/api/issues/:id', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const orgId = req.orgId;
    await client.query('BEGIN');
    const issueRes = await client.query(
      `SELECT ri.id, ri.type, c.organization_id
       FROM reconciliation_issues ri
       JOIN campaigns c ON c.id = ri.campaign_id
       WHERE ri.id = $1 AND c.organization_id = $2`,
      [id, orgId]
    );
    if (issueRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Issue not found' });
    }
    await client.query('DELETE FROM reconciliation_issues WHERE id = $1', [id]);
    await client.query(
      `INSERT INTO activity_events (organization_id, entity_type, entity_id, action, details)
       VALUES ($1, 'issue', $2, 'deleted', $3)`,
      [orgId, id, JSON.stringify({ type: issueRes.rows[0].type })]
    );
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

app.post('/api/issues/detect', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = await runAutoDetection(client, req.orgId);
    await client.query('COMMIT');
    res.json({ created });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

/* ------------------------------------------------------------------ */
/*  Shows & Advertisers (management)                                   */
/* ------------------------------------------------------------------ */

// Shows list with delivery/campaign stats
app.get('/api/shows', async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const { q, sort = 'title', order = 'asc' } = req.query;
    const { page, pageSize, offset } = parsePagination(req.query);

    const where = ['s.organization_id = $1'];
    const params = [orgId];
    if (q) {
      where.push('(s.title ILIKE $2 OR s.category ILIKE $2)');
      params.push(`%${q}%`);
    }
    const sortMap = {
      title: 's.title',
      created_at: 's.created_at',
      campaign_count: 'cc.campaign_count',
      committed_impressions: 'cc.committed_impressions',
      delivered_value: 'COALESCE(dd.delivered_value, 0)',
    };
    const safeSort = sortMap[sort] || sortMap.title;
    const safeOrder = String(order).toLowerCase() === 'desc' ? 'DESC' : 'ASC';

    const rowsSql = `
      SELECT s.id, s.title, s.category, s.created_at,
        COALESCE(cc.campaign_count, 0)::int AS campaign_count,
        COALESCE(cc.active_campaigns, 0)::int AS active_campaigns,
        COALESCE(cc.committed_impressions, 0) AS committed_impressions,
        COALESCE(cc.open_issues, 0)::int AS open_issues,
        COALESCE(dd.delivered_impressions, 0) AS delivered_impressions,
        COALESCE(dd.delivered_value, 0) AS delivered_value,
        COUNT(*) OVER()::int AS total_count
      FROM shows s
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS campaign_count,
          COUNT(*) FILTER (WHERE c.status = 'active') AS active_campaigns,
          SUM(c.committed_impressions) AS committed_impressions,
          (SELECT COUNT(*) FROM reconciliation_issues ri JOIN campaigns c2 ON c2.id = ri.campaign_id
           WHERE c2.show_id = s.id AND ri.resolved = false) AS open_issues
        FROM campaigns c WHERE c.show_id = s.id
      ) cc ON true
      LEFT JOIN LATERAL (
        SELECT SUM(dr.impressions_delivered) AS delivered_impressions,
          SUM(dr.impressions_delivered * c.cpm / 1000.0) AS delivered_value
        FROM delivery_records dr JOIN campaigns c ON c.id = dr.campaign_id
        WHERE c.show_id = s.id
      ) dd ON true
      WHERE ${where.join(' AND ')}
      ORDER BY ${safeSort} ${safeOrder}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    const rowsRes = await pool.query(rowsSql, [...params, pageSize, offset]);
    const countRes = await pool.query(`SELECT COUNT(*)::int AS c FROM shows s WHERE ${where.join(' AND ')}`, params);
    const rows = rowsRes.rows.map((r) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      created_at: r.created_at,
      campaign_count: r.campaign_count,
      active_campaigns: r.active_campaigns,
      committed_impressions: Number(r.committed_impressions),
      delivered_impressions: Number(r.delivered_impressions),
      delivered_value: Math.round(Number(r.delivered_value)),
      open_issues: r.open_issues,
    }));
    res.json(paginated(rows, rows.length ? Number(rowsRes.rows[0].total_count) : Number(countRes.rows[0].c), page, pageSize));
  } catch (err) {
    next(err);
  }
});

app.post('/api/shows', async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const { title, category } = req.body;
    const t = String(title || '').trim();
    if (!t) return res.status(400).json({ error: 'Title is required' });
    const insRes = await pool.query(
      `INSERT INTO shows (organization_id, title, category) VALUES ($1, $2, $3) RETURNING *`,
      [orgId, t, category ? String(category).trim() : 'General']
    ).catch((e) => {
      if (e.code === '23505') return { rows: [], conflict: true };
      throw e;
    });
    if (insRes.rows.length === 0) return res.status(409).json({ error: `Show "${t}" already exists` });
    res.status(201).json(insRes.rows[0]);
  } catch (err) {
    next(err);
  }
});

app.patch('/api/shows/:id', async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const { id } = req.params;
    const { title, category } = req.body;
    const updates = [];
    const params = [];
    if (title != null && String(title).trim()) {
      params.push(String(title).trim());
      updates.push(`title = $${params.length}`);
    }
    if (category != null) {
      params.push(String(category).trim() || 'General');
      updates.push(`category = $${params.length}`);
    }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
    params.push(id, orgId);
    const updRes = await pool.query(
      `UPDATE shows SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length - 1} AND organization_id = $${params.length}
       RETURNING *`,
      params
    );
    if (updRes.rows.length === 0) return res.status(404).json({ error: 'Show not found' });
    res.json(updRes.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A show with this title already exists' });
    next(err);
  }
});

app.delete('/api/shows/:id', async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const { id } = req.params;
    const delRes = await pool.query('DELETE FROM shows WHERE id = $1 AND organization_id = $2 RETURNING id', [id, orgId]);
    if (delRes.rows.length === 0) return res.status(404).json({ error: 'Show not found' });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === '23503') return res.status(409).json({ error: 'This show has campaigns and cannot be deleted' });
    next(err);
  }
});

// Advertisers list with delivery/campaign stats
app.get('/api/advertisers', async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const { q, sort = 'name', order = 'asc' } = req.query;
    const { page, pageSize, offset } = parsePagination(req.query);

    const where = ['a.organization_id = $1'];
    const params = [orgId];
    if (q) {
      where.push('(a.name ILIKE $2 OR COALESCE(a.contact_email, \'\') ILIKE $2)');
      params.push(`%${q}%`);
    }
    const sortMap = {
      name: 'a.name',
      created_at: 'a.created_at',
      campaign_count: 'cc.campaign_count',
      committed_impressions: 'cc.committed_impressions',
      delivered_value: 'COALESCE(dd.delivered_value, 0)',
    };
    const safeSort = sortMap[sort] || sortMap.name;
    const safeOrder = String(order).toLowerCase() === 'desc' ? 'DESC' : 'ASC';

    const rowsSql = `
      SELECT a.id, a.name, a.contact_email, a.created_at,
        COALESCE(cc.campaign_count, 0)::int AS campaign_count,
        COALESCE(cc.active_campaigns, 0)::int AS active_campaigns,
        COALESCE(cc.committed_impressions, 0) AS committed_impressions,
        COALESCE(cc.open_issues, 0)::int AS open_issues,
        COALESCE(dd.delivered_impressions, 0) AS delivered_impressions,
        COALESCE(dd.delivered_value, 0) AS delivered_value,
        COUNT(*) OVER()::int AS total_count
      FROM advertisers a
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS campaign_count,
          COUNT(*) FILTER (WHERE c.status = 'active') AS active_campaigns,
          SUM(c.committed_impressions) AS committed_impressions,
          (SELECT COUNT(*) FROM reconciliation_issues ri JOIN campaigns c2 ON c2.id = ri.campaign_id
           WHERE c2.advertiser_id = a.id AND ri.resolved = false) AS open_issues
        FROM campaigns c WHERE c.advertiser_id = a.id
      ) cc ON true
      LEFT JOIN LATERAL (
        SELECT SUM(dr.impressions_delivered) AS delivered_impressions,
          SUM(dr.impressions_delivered * c.cpm / 1000.0) AS delivered_value
        FROM delivery_records dr JOIN campaigns c ON c.id = dr.campaign_id
        WHERE c.advertiser_id = a.id
      ) dd ON true
      WHERE ${where.join(' AND ')}
      ORDER BY ${safeSort} ${safeOrder}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    const rowsRes = await pool.query(rowsSql, [...params, pageSize, offset]);
    const countRes = await pool.query(`SELECT COUNT(*)::int AS c FROM advertisers a WHERE ${where.join(' AND ')}`, params);
    const rows = rowsRes.rows.map((r) => ({
      id: r.id,
      name: r.name,
      contact_email: r.contact_email,
      created_at: r.created_at,
      campaign_count: r.campaign_count,
      active_campaigns: r.active_campaigns,
      committed_impressions: Number(r.committed_impressions),
      delivered_impressions: Number(r.delivered_impressions),
      delivered_value: Math.round(Number(r.delivered_value)),
      open_issues: r.open_issues,
    }));
    res.json(paginated(rows, rows.length ? Number(rowsRes.rows[0].total_count) : Number(countRes.rows[0].c), page, pageSize));
  } catch (err) {
    next(err);
  }
});

app.post('/api/advertisers', async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const { name, contact_email } = req.body;
    const n = String(name || '').trim();
    if (!n) return res.status(400).json({ error: 'Name is required' });
    const insRes = await pool.query(
      `INSERT INTO advertisers (organization_id, name, contact_email) VALUES ($1, $2, $3) RETURNING *`,
      [orgId, n, contact_email ? String(contact_email).trim() : null]
    ).catch((e) => {
      if (e.code === '23505') return { rows: [], conflict: true };
      throw e;
    });
    if (insRes.rows.length === 0) return res.status(409).json({ error: `Advertiser "${n}" already exists` });
    res.status(201).json(insRes.rows[0]);
  } catch (err) {
    next(err);
  }
});

app.patch('/api/advertisers/:id', async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const { id } = req.params;
    const { name, contact_email } = req.body;
    const updates = [];
    const params = [];
    if (name != null && String(name).trim()) {
      params.push(String(name).trim());
      updates.push(`name = $${params.length}`);
    }
    if (contact_email != null) {
      params.push(String(contact_email).trim() || null);
      updates.push(`contact_email = $${params.length}`);
    }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
    params.push(id, orgId);
    const updRes = await pool.query(
      `UPDATE advertisers SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length - 1} AND organization_id = $${params.length}
       RETURNING *`,
      params
    );
    if (updRes.rows.length === 0) return res.status(404).json({ error: 'Advertiser not found' });
    res.json(updRes.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'An advertiser with this name already exists' });
    next(err);
  }
});

app.delete('/api/advertisers/:id', async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const { id } = req.params;
    const delRes = await pool.query('DELETE FROM advertisers WHERE id = $1 AND organization_id = $2 RETURNING id', [id, orgId]);
    if (delRes.rows.length === 0) return res.status(404).json({ error: 'Advertiser not found' });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === '23503') return res.status(409).json({ error: 'This advertiser has campaigns and cannot be deleted' });
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/*  Reports (per-show / per-advertiser, period-over-period)            */
/* ------------------------------------------------------------------ */

function buildReportSql(dimExpr, dimIdExpr) {
  return `
    SELECT ${dimIdExpr} AS entity_id, ${dimExpr} AS name,
      COUNT(DISTINCT c.id)::int AS campaign_count,
      COUNT(DISTINCT c.id) FILTER (WHERE c.status = 'active')::int AS active_campaigns,
      COALESCE(SUM(c.committed_impressions), 0) AS committed_impressions,
      COALESCE(SUM(d.total), 0) AS delivered_impressions,
      COALESCE(SUM(c.committed_impressions * c.cpm / 1000.0), 0) AS committed_value,
      COALESCE(SUM(d.total * c.cpm / 1000.0), 0) AS delivered_value,
      COALESCE(SUM(mg.total), 0) AS makegood_value,
      COALESCE(SUM(iss.cnt), 0)::int AS open_issues
    FROM campaigns c
    JOIN shows s ON s.id = c.show_id
    JOIN advertisers a ON a.id = c.advertiser_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(impressions_delivered), 0) AS total
      FROM delivery_records dr
      WHERE dr.campaign_id = c.id AND dr.date BETWEEN $2 AND $3
    ) d ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(value), 0) AS total FROM makegoods WHERE campaign_id = c.id AND status = 'approved'
    ) mg ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS cnt FROM reconciliation_issues ri WHERE ri.campaign_id = c.id AND ri.resolved = false
    ) iss ON true
    WHERE c.organization_id = $1 AND c.start_date <= $3 AND c.end_date >= $2
    GROUP BY ${dimIdExpr}, ${dimExpr}
    ORDER BY delivered_value DESC
  `;
}

async function computeReportRows(orgId, groupBy, startSql, endSql) {
  const dimExpr = groupBy === 'advertiser' ? 'a.name' : 's.title';
  const dimIdExpr = groupBy === 'advertiser' ? 'a.id' : 's.id';
  const res = await pool.query(buildReportSql(dimExpr, dimIdExpr), [orgId, startSql, endSql]);
  return res.rows.map((r) => ({
    entity_id: r.entity_id,
    name: r.name,
    campaign_count: r.campaign_count,
    active_campaigns: r.active_campaigns,
    committed_impressions: Number(r.committed_impressions),
    delivered_impressions: Number(r.delivered_impressions),
    committed_value: Math.round(Number(r.committed_value)),
    delivered_value: Math.round(Number(r.delivered_value)),
    makegood_value: Math.round(Number(r.makegood_value)),
    open_issues: r.open_issues,
  }));
}

function shiftWindowBack(startSql, endSql) {
  const start = new Date(`${startSql}T00:00:00Z`);
  const end = new Date(`${endSql}T00:00:00Z`);
  const lenDays = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1);
  const prevEnd = new Date(start.getTime() - 1000 * 60 * 60 * 24);
  const prevStart = new Date(prevEnd.getTime() - (lenDays - 1) * 1000 * 60 * 60 * 24);
  return [prevStart.toISOString().slice(0, 10), prevEnd.toISOString().slice(0, 10)];
}

app.get('/api/reports', async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const groupBy = req.query.group_by === 'advertiser' ? 'advertiser' : 'show';
    const endSql = toSqlDate(req.query.end) || new Date().toISOString().slice(0, 10);
    const startSql =
      toSqlDate(req.query.start) ||
      new Date(Date.now() - 30 * 1000 * 60 * 60 * 24).toISOString().slice(0, 10);
    const [prevStart, prevEnd] = shiftWindowBack(startSql, endSql);

    const [rows, prevRows] = await Promise.all([
      computeReportRows(orgId, groupBy, startSql, endSql),
      computeReportRows(orgId, groupBy, prevStart, prevEnd),
    ]);
    const prevByName = new Map(prevRows.map((r) => [r.name, r]));
    const merged = rows.map((r) => {
      const prev = prevByName.get(r.name);
      return {
        ...r,
        previous: prev
          ? {
              campaign_count: prev.campaign_count,
              delivered_impressions: prev.delivered_impressions,
              delivered_value: prev.delivered_value,
            }
          : null,
      };
    });

    const sum = (arr, key) => arr.reduce((s, r) => s + (Number(r[key]) || 0), 0);
    res.json({
      group_by: groupBy,
      start: startSql,
      end: endSql,
      previous: { start: prevStart, end: prevEnd },
      rows: merged,
      totals: {
        campaign_count: sum(rows, 'campaign_count'),
        committed_impressions: sum(rows, 'committed_impressions'),
        delivered_impressions: sum(rows, 'delivered_impressions'),
        committed_value: sum(rows, 'committed_value'),
        delivered_value: sum(rows, 'delivered_value'),
        makegood_value: sum(rows, 'makegood_value'),
        open_issues: sum(rows, 'open_issues'),
        previous: {
          campaign_count: sum(prevRows, 'campaign_count'),
          delivered_impressions: sum(prevRows, 'delivered_impressions'),
          delivered_value: sum(prevRows, 'delivered_value'),
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/reports/export', async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const groupBy = req.query.group_by === 'advertiser' ? 'advertiser' : 'show';
    const format = req.query.format === 'json' ? 'json' : 'csv';
    const endSql = toSqlDate(req.query.end) || new Date().toISOString().slice(0, 10);
    const startSql =
      toSqlDate(req.query.start) ||
      new Date(Date.now() - 30 * 1000 * 60 * 60 * 24).toISOString().slice(0, 10);

    const rows = await computeReportRows(orgId, groupBy, startSql, endSql);

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="report_${groupBy}_${startSql}_${endSql}.json"`);
      return res.send(JSON.stringify({ group_by: groupBy, start: startSql, end: endSql, rows }, null, 2));
    }

    const headers = [
      groupBy === 'advertiser' ? 'Advertiser' : 'Show',
      'Campaigns', 'Active', 'Committed Impr', 'Delivered Impr',
      'Committed Value', 'Delivered Value', 'Makegood Value', 'Open Issues',
    ];
    const lines = [headers.map(csvEscape).join(',')];
    for (const r of rows) {
      lines.push(
        [r.name, r.campaign_count, r.active_campaigns, r.committed_impressions, r.delivered_impressions,
         r.committed_value, r.delivered_value, r.makegood_value, r.open_issues].map(csvEscape).join(',')
      );
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="report_${groupBy}_${startSql}_${endSql}.csv"`);
    res.send(lines.join('\n'));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/*  Import (CSV → JSON payload)                                        */
/* ------------------------------------------------------------------ */

app.post('/api/import', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { ioRows, deliveryRows } = req.body;
    const orgId = req.orgId;

    if (!Array.isArray(ioRows) || !Array.isArray(deliveryRows)) {
      return res.status(400).json({ error: 'Invalid payload structure' });
    }

    await client.query('BEGIN');

    const errors = [];
    let importedIOs = 0;
    let importedDeliveries = 0;

    for (const row of ioRows) {
      try {
        const showRes = await client.query(
          `INSERT INTO shows (organization_id, title, category)
           VALUES ($1, $2, $3)
           ON CONFLICT (organization_id, title) DO UPDATE SET category = EXCLUDED.category
           RETURNING id`,
          [orgId, row.showTitle, row.category || 'General']
        );
        const advRes = await client.query(
          `INSERT INTO advertisers (organization_id, name, contact_email)
           VALUES ($1, $2, $3)
           ON CONFLICT (organization_id, name) DO UPDATE SET contact_email = EXCLUDED.contact_email
           RETURNING id`,
          [orgId, row.advertiserName, row.email || null]
        );
        await client.query(
          `INSERT INTO campaigns (organization_id, show_id, advertiser_id, io_number, status, start_date, end_date, committed_impressions, cpm)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (organization_id, io_number) DO UPDATE SET
             status = EXCLUDED.status,
             start_date = EXCLUDED.start_date,
             end_date = EXCLUDED.end_date,
             committed_impressions = EXCLUDED.committed_impressions,
             cpm = EXCLUDED.cpm,
             updated_at = NOW()`,
          [
            orgId,
            showRes.rows[0].id,
            advRes.rows[0].id,
            row.ioNumber,
            row.status || 'active',
            toSqlDate(row.startDate),
            toSqlDate(row.endDate),
            row.committedImpressions,
            row.cpm,
          ]
        );
        importedIOs++;
      } catch (e) {
        errors.push({ row: 'io', data: row, error: e.message });
      }
    }

    for (const row of deliveryRows) {
      try {
        const campRes = await client.query(
          'SELECT id FROM campaigns WHERE io_number = $1 AND organization_id = $2',
          [row.ioNumber, orgId]
        );
        if (campRes.rows.length === 0) {
          errors.push({ row: 'delivery', data: row, error: 'Campaign not found' });
          continue;
        }
        await client.query(
          `INSERT INTO delivery_records (campaign_id, date, impressions_delivered, source)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (campaign_id, date, source) DO UPDATE SET impressions_delivered = EXCLUDED.impressions_delivered`,
          [campRes.rows[0].id, toSqlDate(row.date), row.impressions, row.source || 'import']
        );
        importedDeliveries++;
      } catch (e) {
        errors.push({ row: 'delivery', data: row, error: e.message });
      }
    }

    await client.query('COMMIT');

    let autoIssuesDetected = 0;
    if (importedDeliveries > 0) {
      const det = await pool.connect().then(async (c2) => {
        try {
          await c2.query('BEGIN');
          const created = await runAutoDetection(c2, orgId);
          await c2.query('COMMIT');
          return created;
        } catch (e) {
          await c2.query('ROLLBACK').catch(() => {});
          throw e;
        } finally {
          c2.release();
        }
      });
      autoIssuesDetected = det;
    }

    res.json({ success: true, importedIOs, importedDeliveries, autoIssuesDetected, errors });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

/* ------------------------------------------------------------------ */
/*  Export (campaigns CSV)                                             */
/* ------------------------------------------------------------------ */

app.get('/api/export', async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const { whereSql, params, havingSql } = buildCampaignFilters(req.query, orgId);

    const sql = `
      SELECT
        c.io_number,
        s.title as show,
        a.name as advertiser,
        c.status,
        c.start_date,
        c.end_date,
        c.committed_impressions,
        COALESCE(SUM(dr.impressions_delivered), 0) as delivered,
        COUNT(DISTINCT ri.id) FILTER (WHERE ri.resolved = false) as open_issues,
        COALESCE(SUM(mg.value), 0) as makegoods
      FROM campaigns c
      JOIN shows s ON c.show_id = s.id
      JOIN advertisers a ON c.advertiser_id = a.id
      LEFT JOIN delivery_records dr ON c.id = dr.campaign_id
      LEFT JOIN reconciliation_issues ri ON c.id = ri.campaign_id
      LEFT JOIN makegoods mg ON c.id = mg.campaign_id AND mg.status = 'approved'
      WHERE ${whereSql}
      GROUP BY c.id, s.title, a.name
      ${havingSql}
      ORDER BY c.io_number
    `;
    const result = await pool.query(sql, params);

    const headers = ['IO Number', 'Show', 'Advertiser', 'Status', 'Start Date', 'End Date', 'Committed', 'Delivered', 'Open Issues', 'Makegoods Value'];
    const lines = [headers.map(csvEscape).join(',')];
    for (const r of result.rows) {
      lines.push(
        [r.io_number, r.show, r.advertiser, r.status, r.start_date, r.end_date,
         Number(r.committed_impressions), Number(r.delivered), r.open_issues, Number(r.makegoods)]
          .map(csvEscape).join(',')
      );
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="reconciliation_report.csv"');
    res.send(lines.join('\n'));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/*  Dashboard summary, analytics, activity                             */
/* ------------------------------------------------------------------ */

app.get('/api/summary', async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const statsRes = await pool.query(
      `SELECT cs.id, cs.status, cs.committed_impressions, cs.delivered, cs.open_issues, cs.makegood_value,
              c.cpm, c.start_date, c.end_date
       FROM campaign_stats cs JOIN campaigns c ON c.id = cs.id
       WHERE c.organization_id = $1`,
      [orgId]
    );
    const today = new Date().toISOString();
    const rows = statsRes.rows.map((r) => ({
      ...r,
      committed_impressions: Number(r.committed_impressions),
      delivered: Number(r.delivered),
      cpm: Number(r.cpm),
      makegood_value: Number(r.makegood_value || 0),
      open_issues: Number(r.open_issues),
    }));

    const sum = (fn) => rows.reduce((s, r) => s + fn(r), 0);
    const totalCommitted = sum((r) => r.committed_impressions);
    const totalDelivered = sum((r) => r.delivered);
    const pacingCounts = { on_track: 0, slight_risk: 0, at_risk: 0, behind: 0, not_started: 0 };
    for (const r of rows) {
      const pacing = getPacingStatus(r, r.delivered, today);
      pacingCounts[pacing] = (pacingCounts[pacing] || 0) + 1;
    }

    res.json({
      committedRevenue: Math.round(sum((r) => (r.committed_impressions * r.cpm) / 1000)),
      invoiceReadyRevenue: Math.round(
        sum((r) => (r.status === 'completed' && r.open_issues === 0 ? (r.delivered * r.cpm) / 1000 : 0))
      ),
      revenueAtRisk: Math.round(sum((r) => r.makegood_value)),
      deliveryAccuracy: totalCommitted > 0 ? parseFloat(((totalDelivered / totalCommitted) * 100).toFixed(2)) : 0,
      activeCampaigns: rows.filter((r) => r.status === 'active').length,
      openIssues: sum((r) => r.open_issues),
      invoiceReadyCount: rows.filter((r) => r.status === 'completed' && r.open_issues === 0).length,
      totalCampaigns: rows.length,
      pacingCounts,
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/analytics/delivery', async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const result = await pool.query(
      `SELECT to_char(date_trunc('week', dr.date), 'YYYY-MM-DD') AS bucket,
              SUM(dr.impressions_delivered)::bigint AS impressions
       FROM delivery_records dr
       JOIN campaigns c ON c.id = dr.campaign_id
       WHERE c.organization_id = $1
       GROUP BY 1
       ORDER BY 1 DESC
       LIMIT 12`,
      [orgId]
    );
    res.json(result.rows.reverse().map((r) => ({ bucket: r.bucket, impressions: Number(r.impressions) })));
  } catch (err) {
    next(err);
  }
});

app.get('/api/analytics/revenue', async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const result = await pool.query(
      `SELECT a.name AS advertiser, c.committed_impressions, c.cpm,
              COALESCE(SUM(dr.impressions_delivered), 0) AS delivered
       FROM campaigns c
       JOIN advertisers a ON a.id = c.advertiser_id
       LEFT JOIN delivery_records dr ON dr.campaign_id = c.id
       WHERE c.organization_id = $1
       GROUP BY a.name, c.id, c.committed_impressions, c.cpm`,
      [orgId]
    );
    const byAdvertiser = new Map();
    for (const row of result.rows) {
      const committedValue = (Number(row.committed_impressions) * Number(row.cpm)) / 1000;
      const deliveredValue = (Number(row.delivered) * Number(row.cpm)) / 1000;
      const entry = byAdvertiser.get(row.advertiser) || { advertiser: row.advertiser, committed_value: 0, delivered_value: 0 };
      entry.committed_value += committedValue;
      entry.delivered_value += deliveredValue;
      byAdvertiser.set(row.advertiser, entry);
    }
    const rows = Array.from(byAdvertiser.values())
      .map((r) => ({
        advertiser: r.advertiser,
        committed_value: Math.round(r.committed_value),
        delivered_value: Math.round(r.delivered_value),
      }))
      .sort((a, b) => b.committed_value - a.committed_value)
      .slice(0, 8);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

app.get('/api/activity', async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const result = await pool.query(
      `SELECT ae.*, c.io_number, s.title as show_title
       FROM activity_events ae
       LEFT JOIN campaigns c ON ae.entity_id = c.id AND ae.entity_type = 'campaign'
       LEFT JOIN shows s ON c.show_id = s.id
       WHERE ae.organization_id = $1
       ORDER BY ae.created_at DESC
       LIMIT 50`,
      [orgId]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/*  AI insights (OpenRouter)                                           */
/* ------------------------------------------------------------------ */

app.post('/api/ai/insights', async (req, res, next) => {
  try {
    const orgId = req.orgId;

    const statsRes = await pool.query(
      `SELECT cs.id, cs.status, cs.committed_impressions, cs.delivered, cs.open_issues, cs.makegood_value,
              c.cpm, c.start_date, c.end_date, c.io_number,
              a.name AS advertiser, s.title AS show_title
       FROM campaign_stats cs
       JOIN campaigns c ON c.id = cs.id
       JOIN advertisers a ON a.id = c.advertiser_id
       JOIN shows s ON s.id = c.show_id
       WHERE c.organization_id = $1`,
      [orgId]
    );
    const today = new Date().toISOString();
    const rows = statsRes.rows.map((r) => ({
      ...r,
      committed_impressions: Number(r.committed_impressions),
      delivered: Number(r.delivered),
      cpm: Number(r.cpm),
      open_issues: Number(r.open_issues),
    }));

    const sum = (fn) => rows.reduce((s, r) => s + fn(r), 0);
    const totalCommitted = sum((r) => r.committed_impressions);
    const totalDelivered = sum((r) => r.delivered);

    const pacingCounts = { on_track: 0, slight_risk: 0, at_risk: 0, behind: 0, not_started: 0 };
    const riskRank = { behind: 0, at_risk: 1, slight_risk: 2, not_started: 3, on_track: 4 };
    const atRiskCampaigns = [];
    for (const r of rows) {
      const pacing = getPacingStatus(r, r.delivered, today);
      pacingCounts[pacing] += 1;
      if (riskRank[pacing] <= 2 || r.open_issues > 0) {
        atRiskCampaigns.push({
          io: r.io_number,
          advertiser: r.advertiser,
          show: r.show_title,
          status: r.status,
          committed: r.committed_impressions,
          delivered: r.delivered,
          pacing,
        });
      }
    }
    atRiskCampaigns.sort((a, b) => riskRank[a.pacing] - riskRank[b.pacing]);
    atRiskCampaigns.length = Math.min(atRiskCampaigns.length, 8);

    const issuesRes = await pool.query(
      `SELECT ri.type, ri.severity, COUNT(*)::int AS count
       FROM reconciliation_issues ri
       JOIN campaigns c ON c.id = ri.campaign_id
       WHERE c.organization_id = $1 AND ri.resolved = false
       GROUP BY ri.type, ri.severity ORDER BY count DESC LIMIT 8`,
      [orgId]
    );

    const facts = {
      totalCampaigns: rows.length,
      activeCampaigns: rows.filter((r) => r.status === 'active').length,
      deliveryAccuracy: totalCommitted > 0 ? parseFloat(((totalDelivered / totalCommitted) * 100).toFixed(2)) : 0,
      committedRevenue: Math.round(sum((r) => (r.committed_impressions * r.cpm) / 1000)),
      invoiceReadyRevenue: Math.round(
        sum((r) => (r.status === 'completed' && r.open_issues === 0 ? (r.delivered * r.cpm) / 1000 : 0))
      ),
      revenueAtRisk: Math.round(sum((r) => Number(r.makegood_value || 0))),
      openIssues: sum((r) => r.open_issues),
      pacingCounts,
      atRiskCampaigns,
      issueBreakdown: issuesRes.rows,
    };

    const completion = await chatCompletion({
      messages: [
        {
          role: 'system',
          content:
            'You are a podcast advertising operations analyst. Reply in plain text bullets only. Be specific and quantitative. Maximum 150 words.',
        },
        { role: 'user', content: buildInsightsPrompt(facts) },
      ],
      temperature: 0.3,
      // Reasoning models (e.g. z-ai/glm-5.3-flash) spend tokens on hidden
      // reasoning before writing content, so allow a generous budget.
      max_tokens: 3000,
    });

    const msg = completion?.choices?.[0]?.message || {};
    const text = (msg.content || msg.reasoning || '').trim();
    if (!text) throw new Error('AI returned an empty response');

    res.json({ insights: text, generated_at: new Date().toISOString(), model: process.env.OPENROUTER_MODEL });
  } catch (err) {
    if (/OPENROUTER|OpenRouter/.test(err.message || '')) {
      return res.status(503).json({ error: `AI unavailable: ${err.message}` });
    }
    next(err);
  }
});

/* Product expansion: podcasts, episodes, integrations, invoice lifecycle, alerts, and admin. */
installFeatureRoutes(app, pool);

/* ------------------------------------------------------------------ */
/*  Fallthrough & errors                                               */
/* ------------------------------------------------------------------ */

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Payload too large' });
  }
  console.error(err.stack);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message,
  });
});

const server = app.listen(PORT, () => {
  console.log(`API Server running on port ${PORT}`);
});
startBackgroundPodcastSync(pool);

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    pool.end(() => {
      console.log('Database pool closed');
      process.exit(0);
    });
  });
});
