import nodemailer from "nodemailer";
import crypto from "node:crypto";
import { fetchPodcastFeed, validateFeedUrl } from "./lib/rss.mjs";
import { buildInvoicePdf } from "./lib/invoice-pdf.mjs";
import { parsePagination, paginated } from "./lib/helpers.mjs";

const podcastFields = [
  "title",
  "category",
  "rss_url",
  "cover_art_url",
  "network",
  "host",
  "description",
  "website_url",
  "language",
];

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin")
    return res.status(403).json({ error: "Administrator access is required." });
  next();
}

async function activity(
  client,
  req,
  entityType,
  entityId,
  action,
  details = {},
) {
  await client.query(
    `INSERT INTO activity_events (organization_id, entity_type, entity_id, action, details, user_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      req.orgId,
      entityType,
      entityId,
      action,
      JSON.stringify(details),
      req.user?.id || null,
    ],
  );
}

async function syncPodcast(client, orgId, podcastId, feedOverride = null) {
  const found = await client.query(
    "SELECT * FROM shows WHERE id = $1 AND organization_id = $2",
    [podcastId, orgId],
  );
  if (!found.rows[0]) {
    const error = new Error("Podcast not found");
    error.status = 404;
    throw error;
  }
  const current = found.rows[0];
  const feed = await fetchPodcastFeed(feedOverride || current.rss_url);
  await client.query(
    `UPDATE shows SET title=$1, category=COALESCE($2,category), cover_art_url=COALESCE($3,cover_art_url),
       network=COALESCE($4,network), host=COALESCE($5,host), description=COALESCE($6,description),
       website_url=COALESCE($7,website_url), language=COALESCE($8,language), rss_url=$9,
       last_synced_at=NOW(), updated_at=NOW() WHERE id=$10`,
    [
      feed.podcast.title,
      feed.podcast.category,
      feed.podcast.cover_art_url,
      feed.podcast.network,
      feed.podcast.host,
      feed.podcast.description,
      feed.podcast.website_url,
      feed.podcast.language,
      feed.podcast.rss_url,
      podcastId,
    ],
  );
  let imported = 0;
  for (const episode of feed.episodes.slice(0, 1000)) {
    await client.query(
      `INSERT INTO episodes
       (show_id,guid,title,description,published_at,duration_seconds,audio_url,episode_number,season_number,explicit)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (show_id,guid) DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description,
         published_at=EXCLUDED.published_at, duration_seconds=EXCLUDED.duration_seconds,
         audio_url=EXCLUDED.audio_url, episode_number=EXCLUDED.episode_number,
         season_number=EXCLUDED.season_number, explicit=EXCLUDED.explicit, updated_at=NOW()`,
      [
        podcastId,
        episode.guid,
        episode.title,
        episode.description,
        episode.published_at || null,
        episode.duration_seconds,
        episode.audio_url,
        episode.episode_number,
        episode.season_number,
        episode.explicit,
      ],
    );
    imported += 1;
  }
  return {
    podcast: {
      ...current,
      ...feed.podcast,
      id: podcastId,
      last_synced_at: new Date().toISOString(),
    },
    episodes_synced: imported,
  };
}

async function detectAlerts(client, orgId) {
  let created = 0;
  const campaigns = await client.query(
    `SELECT c.id,c.io_number,c.status,c.end_date,c.committed_impressions,
       COALESCE(SUM(dr.impressions_delivered),0)::bigint delivered,
       COUNT(DISTINCT ac.id)::int airchecks
     FROM campaigns c
     LEFT JOIN delivery_records dr ON dr.campaign_id=c.id
     LEFT JOIN airchecks ac ON ac.campaign_id=c.id
     WHERE c.organization_id=$1 AND c.status IN ('active','paused')
     GROUP BY c.id`,
    [orgId],
  );
  for (const row of campaigns.rows) {
    const delivered = Number(row.delivered);
    const committed = Number(row.committed_impressions);
    const days = Math.ceil((new Date(row.end_date) - Date.now()) / 86400000);
    const candidates = [];
    if (committed > 0 && delivered / committed < 0.8)
      candidates.push([
        "under_delivery",
        "high",
        `${row.io_number}: under delivery`,
        `${delivered.toLocaleString()} of ${committed.toLocaleString()} impressions have delivered.`,
      ]);
    if (row.airchecks === 0)
      candidates.push([
        "missing_aircheck",
        "medium",
        `${row.io_number}: missing aircheck`,
        "No aircheck has been attached to this campaign.",
      ]);
    if (days >= 0 && days <= 7)
      candidates.push([
        "campaign_deadline",
        days <= 2 ? "high" : "medium",
        `${row.io_number}: deadline approaching`,
        `Campaign ends in ${days} day${days === 1 ? "" : "s"}.`,
      ]);
    for (const [type, severity, title, message] of candidates) {
      const result = await client.query(
        `INSERT INTO alerts (organization_id,campaign_id,alert_type,severity,title,message,due_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (organization_id,campaign_id,alert_type,title) WHERE campaign_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [orgId, row.id, type, severity, title, message, row.end_date],
      );
      created += result.rowCount;
    }
  }
  return created;
}

async function invoiceRecord(client, orgId, invoiceId) {
  const result = await client.query(
    `SELECT i.*,o.name organization_name,o.payment_terms_days,o.alert_email organization_email,
       c.io_number,c.start_date,c.end_date,c.committed_impressions,c.cpm,
       s.title podcast_title,a.name advertiser_name,a.contact_email,
       COALESCE((SELECT SUM(impressions_delivered) FROM delivery_records WHERE campaign_id=c.id),0)::bigint delivered_impressions,
       COALESCE((SELECT SUM(value) FROM makegoods WHERE campaign_id=c.id AND status='approved'),0) makegood_value
     FROM invoices i JOIN organizations o ON o.id=i.organization_id JOIN campaigns c ON c.id=i.campaign_id
     JOIN shows s ON s.id=c.show_id JOIN advertisers a ON a.id=c.advertiser_id
     WHERE i.id=$1 AND i.organization_id=$2`,
    [invoiceId, orgId],
  );
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  row.net_due = Math.max(0, Number(row.amount) - Number(row.makegood_value));
  return row;
}

export function installFeatureRoutes(app, pool) {
  app.get("/api/podcasts", async (req, res, next) => {
    try {
      const { page, pageSize, offset } = parsePagination(req.query);
      const params = [req.orgId];
      const where = ["s.organization_id=$1"];
      if (req.query.q) {
        params.push(`%${req.query.q}%`);
        where.push(
          `(s.title ILIKE $${params.length} OR s.host ILIKE $${params.length} OR s.network ILIKE $${params.length})`,
        );
      }
      const result = await pool.query(
        `SELECT s.*,COUNT(DISTINCT e.id)::int episode_count,
           COUNT(DISTINCT c.id)::int campaign_count,COUNT(*) OVER()::int total_count
         FROM shows s LEFT JOIN episodes e ON e.show_id=s.id LEFT JOIN campaigns c ON c.show_id=s.id
         WHERE ${where.join(" AND ")} GROUP BY s.id
         ORDER BY s.title ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, pageSize, offset],
      );
      const total = result.rows[0]?.total_count || 0;
      res.json(
        paginated(
          result.rows.map((row) => {
            const clean = { ...row };
            delete clean.total_count;
            return clean;
          }),
          total,
          page,
          pageSize,
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/podcasts", async (req, res, next) => {
    try {
      const values = podcastFields.map((field) =>
        req.body?.[field] == null
          ? null
          : String(req.body[field]).trim() || null,
      );
      if (!values[0])
        return res.status(400).json({ error: "Podcast title is required." });
      const result = await pool.query(
        `INSERT INTO shows (organization_id,${podcastFields.join(",")}) VALUES ($1,${values.map((_, i) => `$${i + 2}`).join(",")}) RETURNING *`,
        [req.orgId, ...values],
      );
      await activity(pool, req, "podcast", result.rows[0].id, "created", {
        title: values[0],
      });
      res.status(201).json(result.rows[0]);
    } catch (error) {
      if (error.code === "23505")
        return res
          .status(409)
          .json({
            error: "A podcast with this title or RSS URL already exists.",
          });
      next(error);
    }
  });

  app.patch("/api/podcasts/:id", async (req, res, next) => {
    try {
      const updates = [];
      const params = [];
      for (const field of podcastFields)
        if (Object.hasOwn(req.body || {}, field)) {
          params.push(
            req.body[field] == null
              ? null
              : String(req.body[field]).trim() || null,
          );
          updates.push(`${field}=$${params.length}`);
        }
      if (!updates.length)
        return res.status(400).json({ error: "Nothing to update." });
      params.push(req.params.id, req.orgId);
      const result = await pool.query(
        `UPDATE shows SET ${updates.join(",")},updated_at=NOW() WHERE id=$${params.length - 1} AND organization_id=$${params.length} RETURNING *`,
        params,
      );
      if (!result.rows[0])
        return res.status(404).json({ error: "Podcast not found." });
      await activity(pool, req, "podcast", req.params.id, "updated", {
        fields: updates.map((u) => u.split("=")[0]),
      });
      res.json(result.rows[0]);
    } catch (error) {
      if (error.code === "23505")
        return res
          .status(409)
          .json({ error: "That title or RSS URL is already in use." });
      next(error);
    }
  });

  app.delete("/api/podcasts/:id", async (req, res, next) => {
    try {
      const result = await pool.query(
        "DELETE FROM shows WHERE id=$1 AND organization_id=$2 RETURNING id,title",
        [req.params.id, req.orgId],
      );
      if (!result.rows[0])
        return res
          .status(404)
          .json({ error: "Podcast not found or is still used by a campaign." });
      await activity(pool, req, "podcast", result.rows[0].id, "deleted", {
        title: result.rows[0].title,
      });
      res.json({ ok: true });
    } catch (error) {
      if (error.code === "23503")
        return res
          .status(409)
          .json({ error: "This podcast has campaigns and cannot be deleted." });
      next(error);
    }
  });

  app.post("/api/podcasts/import-rss", async (req, res, next) => {
    const client = await pool.connect();
    try {
      const feed = await fetchPodcastFeed(req.body?.rss_url);
      await client.query("BEGIN");
      const existing = await client.query(
        "SELECT id FROM shows WHERE organization_id=$1 AND (rss_url=$2 OR title=$3)",
        [req.orgId, feed.podcast.rss_url, feed.podcast.title],
      );
      let id = existing.rows[0]?.id;
      if (!id) {
        const inserted = await client.query(
          "INSERT INTO shows (organization_id,title,category,rss_url) VALUES ($1,$2,$3,$4) RETURNING id",
          [
            req.orgId,
            feed.podcast.title,
            feed.podcast.category,
            feed.podcast.rss_url,
          ],
        );
        id = inserted.rows[0].id;
      }
      const synced = await syncPodcast(
        client,
        req.orgId,
        id,
        feed.podcast.rss_url,
      );
      await activity(client, req, "podcast", id, "rss_imported", {
        episodes: synced.episodes_synced,
      });
      await client.query("COMMIT");
      res.status(existing.rows[0] ? 200 : 201).json(synced);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      if (/RSS|feed|HTTP|Private|demo|Local|valid/.test(error.message))
        return res.status(422).json({ error: error.message });
      next(error);
    } finally {
      client.release();
    }
  });

  app.post("/api/podcasts/:id/sync", async (req, res, next) => {
    const client = await pool.connect();
    try {
      const synced = await syncPodcast(client, req.orgId, req.params.id);
      await activity(client, req, "podcast", req.params.id, "rss_synced", {
        episodes: synced.episodes_synced,
      });
      res.json(synced);
    } catch (error) {
      if (error.status)
        return res.status(error.status).json({ error: error.message });
      if (/RSS|feed|HTTP|Private|demo|Local|valid/.test(error.message))
        return res.status(422).json({ error: error.message });
      next(error);
    } finally {
      client.release();
    }
  });

  app.get("/api/episodes", async (req, res, next) => {
    try {
      const { page, pageSize, offset } = parsePagination(req.query);
      const params = [req.orgId];
      const where = ["s.organization_id=$1"];
      if (req.query.podcast) {
        params.push(req.query.podcast);
        where.push(`e.show_id=$${params.length}`);
      }
      if (req.query.q) {
        params.push(`%${req.query.q}%`);
        where.push(
          `(e.title ILIKE $${params.length} OR s.title ILIKE $${params.length})`,
        );
      }
      const result = await pool.query(
        `SELECT e.*,s.title podcast_title,s.cover_art_url,COUNT(a.id)::int ad_slot_count,
       COUNT(*) OVER()::int total_count FROM episodes e JOIN shows s ON s.id=e.show_id
       LEFT JOIN ad_slots a ON a.episode_id=e.id WHERE ${where.join(" AND ")} GROUP BY e.id,s.id
       ORDER BY e.published_at DESC NULLS LAST,e.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, pageSize, offset],
      );
      res.json(
        paginated(
          result.rows.map((row) => {
            const clean = { ...row };
            delete clean.total_count;
            return clean;
          }),
          result.rows[0]?.total_count || 0,
          page,
          pageSize,
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/episodes/:id", async (req, res, next) => {
    try {
      const episode = await pool.query(
        `SELECT e.*,s.title podcast_title FROM episodes e JOIN shows s ON s.id=e.show_id WHERE e.id=$1 AND s.organization_id=$2`,
        [req.params.id, req.orgId],
      );
      if (!episode.rows[0])
        return res.status(404).json({ error: "Episode not found." });
      const slots = await pool.query(
        `SELECT a.*,c.io_number,adv.name advertiser_name FROM ad_slots a LEFT JOIN campaigns c ON c.id=a.campaign_id LEFT JOIN advertisers adv ON adv.id=c.advertiser_id WHERE a.episode_id=$1 ORDER BY a.position_seconds NULLS LAST`,
        [req.params.id],
      );
      res.json({ ...episode.rows[0], ad_slots: slots.rows });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/episodes", async (req, res, next) => {
    try {
      const {
        show_id,
        title,
        guid,
        description,
        published_at,
        duration_seconds,
        audio_url,
        episode_number,
        season_number,
        explicit,
      } = req.body || {};
      if (!show_id || !String(title || "").trim())
        return res
          .status(400)
          .json({ error: "Podcast and title are required." });
      const owned = await pool.query(
        "SELECT id FROM shows WHERE id=$1 AND organization_id=$2",
        [show_id, req.orgId],
      );
      if (!owned.rows[0])
        return res.status(404).json({ error: "Podcast not found." });
      const result = await pool.query(
        `INSERT INTO episodes (show_id,guid,title,description,published_at,duration_seconds,audio_url,episode_number,season_number,explicit)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          show_id,
          guid || `manual:${crypto.randomUUID()}`,
          String(title).trim(),
          description || null,
          published_at || null,
          duration_seconds || null,
          audio_url || null,
          episode_number || null,
          season_number || null,
          Boolean(explicit),
        ],
      );
      await activity(pool, req, "episode", result.rows[0].id, "created", {
        title: result.rows[0].title,
      });
      res.status(201).json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/episodes/:id", async (req, res, next) => {
    try {
      const allowed = [
        "title",
        "description",
        "published_at",
        "duration_seconds",
        "audio_url",
        "episode_number",
        "season_number",
        "explicit",
      ];
      const updates = [];
      const params = [];
      for (const field of allowed)
        if (Object.hasOwn(req.body || {}, field)) {
          params.push(req.body[field] ?? null);
          updates.push(`${field}=$${params.length}`);
        }
      if (!updates.length)
        return res.status(400).json({ error: "Nothing to update." });
      params.push(req.params.id, req.orgId);
      const result = await pool.query(
        `UPDATE episodes e SET ${updates.join(",")},updated_at=NOW() FROM shows s WHERE e.id=$${params.length - 1} AND e.show_id=s.id AND s.organization_id=$${params.length} RETURNING e.*`,
        params,
      );
      if (!result.rows[0])
        return res.status(404).json({ error: "Episode not found." });
      await activity(pool, req, "episode", req.params.id, "updated");
      res.json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/episodes/:id", async (req, res, next) => {
    try {
      const result = await pool.query(
        `DELETE FROM episodes e USING shows s WHERE e.id=$1 AND e.show_id=s.id AND s.organization_id=$2 RETURNING e.id,e.title`,
        [req.params.id, req.orgId],
      );
      if (!result.rows[0])
        return res.status(404).json({ error: "Episode not found." });
      await activity(pool, req, "episode", req.params.id, "deleted", {
        title: result.rows[0].title,
      });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/episodes/:id/ad-slots", async (req, res, next) => {
    try {
      const owned = await pool.query(
        `SELECT e.id FROM episodes e JOIN shows s ON s.id=e.show_id WHERE e.id=$1 AND s.organization_id=$2`,
        [req.params.id, req.orgId],
      );
      if (!owned.rows[0])
        return res.status(404).json({ error: "Episode not found." });
      const {
        campaign_id,
        slot_type = "mid_roll",
        position_seconds,
        duration_seconds = 60,
        status = "planned",
        expected_impressions = 0,
        delivered_impressions = 0,
        aircheck_url,
        notes,
      } = req.body || {};
      const result = await pool.query(
        `INSERT INTO ad_slots(episode_id,campaign_id,slot_type,position_seconds,duration_seconds,status,expected_impressions,delivered_impressions,aircheck_url,notes)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          req.params.id,
          campaign_id || null,
          slot_type,
          position_seconds ?? null,
          duration_seconds,
          status,
          expected_impressions,
          delivered_impressions,
          aircheck_url || null,
          notes || null,
        ],
      );
      await activity(pool, req, "ad_slot", result.rows[0].id, "created", {
        episode_id: req.params.id,
      });
      res.status(201).json(result.rows[0]);
    } catch (error) {
      if (error.code === "23505")
        return res
          .status(409)
          .json({ error: "That slot already exists at this position." });
      next(error);
    }
  });

  app.patch("/api/ad-slots/:id", async (req, res, next) => {
    try {
      const allowed = [
        "campaign_id",
        "slot_type",
        "position_seconds",
        "duration_seconds",
        "status",
        "expected_impressions",
        "delivered_impressions",
        "aircheck_url",
        "notes",
      ];
      const updates = [];
      const params = [];
      for (const field of allowed)
        if (Object.hasOwn(req.body || {}, field)) {
          params.push(req.body[field] ?? null);
          updates.push(`${field}=$${params.length}`);
        }
      if (!updates.length)
        return res.status(400).json({ error: "Nothing to update." });
      params.push(req.params.id, req.orgId);
      const result = await pool.query(
        `UPDATE ad_slots a SET ${updates.join(",")},updated_at=NOW() FROM episodes e,shows s WHERE a.id=$${params.length - 1} AND a.episode_id=e.id AND e.show_id=s.id AND s.organization_id=$${params.length} RETURNING a.*`,
        params,
      );
      if (!result.rows[0])
        return res.status(404).json({ error: "Ad slot not found." });
      await activity(pool, req, "ad_slot", req.params.id, "updated");
      res.json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/ad-slots/:id", async (req, res, next) => {
    try {
      const result = await pool.query(
        `DELETE FROM ad_slots a USING episodes e,shows s WHERE a.id=$1 AND a.episode_id=e.id AND e.show_id=s.id AND s.organization_id=$2 RETURNING a.id`,
        [req.params.id, req.orgId],
      );
      if (!result.rows[0])
        return res.status(404).json({ error: "Ad slot not found." });
      await activity(pool, req, "ad_slot", req.params.id, "deleted");
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/integrations", async (req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT p.*,(SELECT row_to_json(r) FROM (SELECT status,records_processed,message,completed_at FROM integration_sync_runs WHERE integration_id=p.id ORDER BY started_at DESC LIMIT 1) r) last_run FROM provider_integrations p WHERE organization_id=$1 ORDER BY created_at`,
        [req.orgId],
      );
      res.json(result.rows);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/integrations", requireAdmin, async (req, res, next) => {
    try {
      const {
        name,
        provider,
        integration_type,
        endpoint_url,
        api_key_env,
        status = "paused",
      } = req.body || {};
      if (!name || !provider || !integration_type)
        return res
          .status(400)
          .json({
            error: "Name, provider, and integration type are required.",
          });
      const result = await pool.query(
        `INSERT INTO provider_integrations(organization_id,name,provider,integration_type,endpoint_url,api_key_env,status) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          req.orgId,
          String(name).trim(),
          String(provider).trim(),
          integration_type,
          endpoint_url || null,
          api_key_env || null,
          status,
        ],
      );
      await activity(pool, req, "integration", result.rows[0].id, "created", {
        provider,
      });
      res.status(201).json(result.rows[0]);
    } catch (error) {
      if (error.code === "23505")
        return res
          .status(409)
          .json({ error: "An integration with that name already exists." });
      next(error);
    }
  });

  app.patch("/api/integrations/:id", requireAdmin, async (req, res, next) => {
    try {
      const allowed = [
        "name",
        "provider",
        "integration_type",
        "endpoint_url",
        "api_key_env",
        "status",
      ];
      const updates = [];
      const params = [];
      for (const field of allowed)
        if (Object.hasOwn(req.body || {}, field)) {
          params.push(req.body[field] || null);
          updates.push(`${field}=$${params.length}`);
        }
      if (!updates.length)
        return res.status(400).json({ error: "Nothing to update." });
      params.push(req.params.id, req.orgId);
      const result = await pool.query(
        `UPDATE provider_integrations SET ${updates.join(",")},updated_at=NOW() WHERE id=$${params.length - 1} AND organization_id=$${params.length} RETURNING *`,
        params,
      );
      if (!result.rows[0])
        return res.status(404).json({ error: "Integration not found." });
      await activity(pool, req, "integration", req.params.id, "updated");
      res.json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/integrations/:id", requireAdmin, async (req, res, next) => {
    try {
      const result = await pool.query(
        "DELETE FROM provider_integrations WHERE id=$1 AND organization_id=$2 RETURNING id",
        [req.params.id, req.orgId],
      );
      if (!result.rows[0])
        return res.status(404).json({ error: "Integration not found." });
      await activity(pool, req, "integration", req.params.id, "deleted");
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post(
    "/api/integrations/:id/sync",
    requireAdmin,
    async (req, res) => {
      const client = await pool.connect();
      let runId;
      try {
        const found = await client.query(
          "SELECT * FROM provider_integrations WHERE id=$1 AND organization_id=$2",
          [req.params.id, req.orgId],
        );
        const integration = found.rows[0];
        if (!integration)
          return res.status(404).json({ error: "Integration not found." });
        const run = await client.query(
          `INSERT INTO integration_sync_runs(integration_id,status) VALUES($1,'running') RETURNING id`,
          [integration.id],
        );
        runId = run.rows[0].id;
        let processed = 0;
        if (integration.integration_type === "hosting") {
          const feeds = await client.query(
            `SELECT id FROM shows WHERE organization_id=$1 AND rss_url IS NOT NULL AND rss_url NOT LIKE '%example.com%'`,
            [req.orgId],
          );
          for (const podcast of feeds.rows) {
            const result = await syncPodcast(client, req.orgId, podcast.id);
            processed += result.episodes_synced;
          }
        } else if (integration.integration_type === "ad_server") {
          if (!integration.endpoint_url)
            throw new Error("Add the provider endpoint URL before syncing.");
          await validateFeedUrl(integration.endpoint_url);
          const key = integration.api_key_env
            ? process.env[integration.api_key_env]
            : null;
          if (integration.api_key_env && !key)
            throw new Error(
              `Server environment variable ${integration.api_key_env} is not configured.`,
            );
          const response = await fetch(integration.endpoint_url, {
            signal: AbortSignal.timeout(15000),
            redirect: "error",
            headers: key ? { Authorization: `Bearer ${key}` } : {},
          });
          if (!response.ok)
            throw new Error(`Provider returned ${response.status}.`);
          const payload = await response.json();
          const deliveries = Array.isArray(payload)
            ? payload
            : payload.deliveries;
          if (!Array.isArray(deliveries))
            throw new Error("Provider JSON must contain a deliveries array.");
          for (const delivery of deliveries) {
            const campaign = await client.query(
              "SELECT id FROM campaigns WHERE organization_id=$1 AND io_number=$2",
              [req.orgId, delivery.io_number],
            );
            if (!campaign.rows[0]) continue;
            await client.query(
              `INSERT INTO delivery_records(campaign_id,date,impressions_delivered,source) VALUES($1,$2,$3,$4) ON CONFLICT(campaign_id,date,source) DO UPDATE SET impressions_delivered=EXCLUDED.impressions_delivered`,
              [
                campaign.rows[0].id,
                delivery.date,
                Number(delivery.impressions || 0),
                delivery.source || integration.provider,
              ],
            );
            processed += 1;
          }
        } else {
          throw new Error(
            "Email integrations are tested by sending an invoice.",
          );
        }
        await client.query(
          `UPDATE integration_sync_runs SET status='succeeded',records_processed=$1,message='Sync completed',completed_at=NOW() WHERE id=$2`,
          [processed, runId],
        );
        await client.query(
          `UPDATE provider_integrations SET status='connected',last_synced_at=NOW(),sync_error=NULL,updated_at=NOW() WHERE id=$1`,
          [integration.id],
        );
        await activity(client, req, "integration", integration.id, "synced", {
          records_processed: processed,
        });
        res.json({ ok: true, records_processed: processed });
      } catch (error) {
        if (runId)
          await client
            .query(
              `UPDATE integration_sync_runs SET status='failed',message=$1,completed_at=NOW() WHERE id=$2`,
              [error.message, runId],
            )
            .catch(() => {});
        await client
          .query(
            `UPDATE provider_integrations SET status='error',sync_error=$1,updated_at=NOW() WHERE id=$2 AND organization_id=$3`,
            [error.message, req.params.id, req.orgId],
          )
          .catch(() => {});
        return res.status(422).json({ error: error.message });
      } finally {
        client.release();
      }
    },
  );

  app.get("/api/invoices", async (req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT i.*,c.io_number,c.start_date,c.end_date,s.title podcast_title,a.name advertiser_name FROM invoices i JOIN campaigns c ON c.id=i.campaign_id JOIN shows s ON s.id=c.show_id JOIN advertisers a ON a.id=c.advertiser_id WHERE i.organization_id=$1 ORDER BY i.created_at DESC`,
        [req.orgId],
      );
      res.json(result.rows);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/invoices/:campaignId/generate", async (req, res, next) => {
    try {
      const campaign = await pool.query(
        `SELECT c.*,a.contact_email,COALESCE(SUM(dr.impressions_delivered),0)::bigint delivered,o.invoice_prefix,o.payment_terms_days FROM campaigns c JOIN advertisers a ON a.id=c.advertiser_id JOIN organizations o ON o.id=c.organization_id LEFT JOIN delivery_records dr ON dr.campaign_id=c.id WHERE c.id=$1 AND c.organization_id=$2 GROUP BY c.id,a.contact_email,o.id`,
        [req.params.campaignId, req.orgId],
      );
      if (!campaign.rows[0])
        return res.status(404).json({ error: "Campaign not found." });
      const row = campaign.rows[0];
      const amount = (Number(row.delivered) * Number(row.cpm)) / 1000;
      const invoiceNumber = `${row.invoice_prefix}-${row.io_number}`;
      const result = await pool.query(
        `INSERT INTO invoices(organization_id,campaign_id,invoice_number,recipient_email,amount,due_at) VALUES($1,$2,$3,$4,$5,NOW()+($6||' days')::interval) ON CONFLICT(campaign_id) DO UPDATE SET amount=EXCLUDED.amount,recipient_email=COALESCE(EXCLUDED.recipient_email,invoices.recipient_email),updated_at=NOW() RETURNING *`,
        [
          req.orgId,
          row.id,
          invoiceNumber,
          row.contact_email,
          amount,
          row.payment_terms_days,
        ],
      );
      await activity(pool, req, "invoice", result.rows[0].id, "generated", {
        invoice_number: invoiceNumber,
      });
      res.status(201).json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/invoices/:id/pdf", async (req, res, next) => {
    try {
      const invoice = await invoiceRecord(pool, req.orgId, req.params.id);
      if (!invoice)
        return res.status(404).json({ error: "Invoice not found." });
      const pdf = await buildInvoicePdf(invoice);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${invoice.invoice_number.replace(/[^a-z0-9-]/gi, "_")}.pdf"`,
      );
      res.send(pdf);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/invoices/:id/send", async (req, res, next) => {
    try {
      const invoice = await invoiceRecord(pool, req.orgId, req.params.id);
      if (!invoice)
        return res.status(404).json({ error: "Invoice not found." });
      const recipient = String(
        req.body?.recipient_email ||
          invoice.recipient_email ||
          invoice.contact_email ||
          "",
      ).trim();
      if (!recipient)
        return res
          .status(400)
          .json({ error: "Add a recipient email before sending." });
      if (!process.env.SMTP_HOST)
        return res
          .status(503)
          .json({
            error:
              "SMTP is not configured. Add SMTP_HOST and related credentials to the server environment.",
          });
      const transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === "true",
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
      });
      const pdf = await buildInvoicePdf(invoice);
      await transport.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: recipient,
        subject: `Invoice ${invoice.invoice_number} from ${invoice.organization_name}`,
        text: `Invoice ${invoice.invoice_number} for ${invoice.podcast_title} is attached. Amount due: $${Number(invoice.net_due).toFixed(2)}.`,
        attachments: [
          { filename: `${invoice.invoice_number}.pdf`, content: pdf },
        ],
      });
      const result = await pool.query(
        `UPDATE invoices SET recipient_email=$1,status='sent',sent_at=NOW(),updated_at=NOW() WHERE id=$2 RETURNING *`,
        [recipient, invoice.id],
      );
      await activity(pool, req, "invoice", invoice.id, "sent", { recipient });
      res.json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/invoices/:id", async (req, res, next) => {
    try {
      const allowed = ["recipient_email", "status", "due_at"];
      const updates = [];
      const params = [];
      for (const field of allowed)
        if (Object.hasOwn(req.body || {}, field)) {
          params.push(req.body[field] || null);
          updates.push(`${field}=$${params.length}`);
        }
      if (req.body?.status === "paid") updates.push("paid_at=NOW()");
      if (!updates.length)
        return res.status(400).json({ error: "Nothing to update." });
      params.push(req.params.id, req.orgId);
      const result = await pool.query(
        `UPDATE invoices SET ${updates.join(",")},updated_at=NOW() WHERE id=$${params.length - 1} AND organization_id=$${params.length} RETURNING *`,
        params,
      );
      if (!result.rows[0])
        return res.status(404).json({ error: "Invoice not found." });
      await activity(pool, req, "invoice", req.params.id, "updated", {
        status: req.body?.status,
      });
      res.json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/alerts", async (req, res, next) => {
    try {
      const params = [req.orgId];
      let filter = "";
      if (req.query.status) {
        params.push(req.query.status);
        filter = ` AND al.status=$${params.length}`;
      }
      const result = await pool.query(
        `SELECT al.*,c.io_number,s.title podcast_title FROM alerts al LEFT JOIN campaigns c ON c.id=al.campaign_id LEFT JOIN shows s ON s.id=c.show_id WHERE al.organization_id=$1${filter} ORDER BY CASE al.severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,al.created_at DESC`,
        params,
      );
      res.json(result.rows);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/alerts/detect", async (req, res, next) => {
    const client = await pool.connect();
    try {
      const created = await detectAlerts(client, req.orgId);
      await activity(
        client,
        req,
        "alert",
        crypto.randomUUID(),
        "detection_run",
        { created },
      );
      res.json({ created });
    } catch (error) {
      next(error);
    } finally {
      client.release();
    }
  });

  app.patch("/api/alerts/:id", async (req, res, next) => {
    try {
      if (!["open", "dismissed", "resolved"].includes(req.body?.status))
        return res
          .status(400)
          .json({ error: "Choose open, dismissed, or resolved." });
      const result = await pool.query(
        "UPDATE alerts SET status=$1,updated_at=NOW() WHERE id=$2 AND organization_id=$3 RETURNING *",
        [req.body.status, req.params.id, req.orgId],
      );
      if (!result.rows[0])
        return res.status(404).json({ error: "Alert not found." });
      await activity(pool, req, "alert", req.params.id, "status_changed", {
        status: req.body.status,
      });
      res.json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/settings", async (req, res, next) => {
    try {
      const result = await pool.query(
        "SELECT id,name,timezone,invoice_prefix,payment_terms_days,alert_email,automatic_alerts,created_at,updated_at FROM organizations WHERE id=$1",
        [req.orgId],
      );
      res.json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/settings", requireAdmin, async (req, res, next) => {
    try {
      const allowed = [
        "name",
        "timezone",
        "invoice_prefix",
        "payment_terms_days",
        "alert_email",
        "automatic_alerts",
      ];
      const updates = [];
      const params = [];
      for (const field of allowed)
        if (Object.hasOwn(req.body || {}, field)) {
          params.push(req.body[field] ?? null);
          updates.push(`${field}=$${params.length}`);
        }
      if (!updates.length)
        return res.status(400).json({ error: "Nothing to update." });
      params.push(req.orgId);
      const result = await pool.query(
        `UPDATE organizations SET ${updates.join(",")},updated_at=NOW() WHERE id=$${params.length} RETURNING id,name,timezone,invoice_prefix,payment_terms_days,alert_email,automatic_alerts`,
        params,
      );
      await activity(pool, req, "organization", req.orgId, "settings_updated", {
        fields: updates.map((u) => u.split("=")[0]),
      });
      res.json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/users", requireAdmin, async (req, res, next) => {
    try {
      const result = await pool.query(
        "SELECT id,email,name,role,created_at,updated_at FROM users WHERE organization_id=$1 ORDER BY created_at",
        [req.orgId],
      );
      res.json(result.rows);
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/users/:id/role", requireAdmin, async (req, res, next) => {
    const client = await pool.connect();
    try {
      const role = req.body?.role;
      if (!["admin", "member", "viewer"].includes(role))
        return res
          .status(400)
          .json({ error: "Choose admin, member, or viewer." });
      const target = await client.query(
        "SELECT id,role FROM users WHERE id=$1 AND organization_id=$2",
        [req.params.id, req.orgId],
      );
      if (!target.rows[0])
        return res.status(404).json({ error: "User not found." });
      if (target.rows[0].role === "admin" && role !== "admin") {
        const admins = await client.query(
          "SELECT COUNT(*)::int count FROM users WHERE organization_id=$1 AND role='admin'",
          [req.orgId],
        );
        if (admins.rows[0].count <= 1)
          return res
            .status(409)
            .json({
              error: "The workspace must keep at least one administrator.",
            });
      }
      const result = await client.query(
        "UPDATE users SET role=$1,updated_at=NOW() WHERE id=$2 RETURNING id,email,name,role",
        [role, req.params.id],
      );
      await activity(client, req, "user", req.params.id, "role_changed", {
        role,
      });
      res.json(result.rows[0]);
    } catch (error) {
      next(error);
    } finally {
      client.release();
    }
  });

  app.get("/api/audit", requireAdmin, async (req, res, next) => {
    try {
      const { page, pageSize, offset } = parsePagination(req.query, {
        pageSize: 50,
        maxPageSize: 100,
      });
      const result = await pool.query(
        `SELECT ae.*,u.email user_email,u.name user_name,COUNT(*) OVER()::int total_count FROM activity_events ae LEFT JOIN users u ON u.id::text=ae.user_id WHERE ae.organization_id=$1 ORDER BY ae.created_at DESC LIMIT $2 OFFSET $3`,
        [req.orgId, pageSize, offset],
      );
      res.json(
        paginated(
          result.rows.map((row) => {
            const clean = { ...row };
            delete clean.total_count;
            return clean;
          }),
          result.rows[0]?.total_count || 0,
          page,
          pageSize,
        ),
      );
    } catch (error) {
      next(error);
    }
  });
}

export function startBackgroundPodcastSync(pool) {
  const minutes = Number(process.env.RSS_SYNC_INTERVAL_MINUTES || 60);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  const timer = setInterval(
    async () => {
      const client = await pool.connect();
      try {
        const podcasts = await client.query(
          `SELECT id,organization_id FROM shows WHERE rss_url IS NOT NULL AND rss_url NOT LIKE '%example.com%'`,
        );
        for (const podcast of podcasts.rows) {
          try {
            await syncPodcast(client, podcast.organization_id, podcast.id);
          } catch (error) {
            console.error(`RSS sync failed for ${podcast.id}:`, error.message);
          }
        }
      } finally {
        client.release();
      }
    },
    minutes * 60 * 1000,
  );
  timer.unref();
  return timer;
}
