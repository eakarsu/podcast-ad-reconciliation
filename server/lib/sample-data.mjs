const SHOWS = [
  ['Signal & Noise', 'Technology'],
  ['The Daily Ledger', 'Business'],
  ['Curious Minds', 'Education'],
  ['Founder Frequency', 'Entrepreneurship'],
  ['Healthy Habits Lab', 'Health'],
  ['The Long Weekend', 'Travel'],
  ['Culture Current', 'Arts & Culture'],
  ['Market Makers', 'Finance'],
  ['The Science Desk', 'Science'],
  ['Home Field Stories', 'Sports'],
  ['Kitchen Table', 'Food'],
  ['Design Details', 'Design'],
  ['Climate Briefing', 'Environment'],
  ['After the Credits', 'Entertainment'],
  ['Modern Parenting', 'Family'],
  ['Policy in Practice', 'News'],
  ['The Reading Room', 'Books'],
  ['Built for Tomorrow', 'Innovation'],
];

const ADVERTISERS = [
  ['Northstar Analytics', 'media@northstaranalytics.example'],
  ['BrightBean Coffee', 'partnerships@brightbean.example'],
  ['Orbit Mobile', 'audio@orbitmobile.example'],
  ['Juniper Health', 'growth@juniperhealth.example'],
  ['Papertrail Books', 'podcasts@papertrail.example'],
  ['Harbor Financial', 'brand@harborfinancial.example'],
  ['Fieldnote Travel', 'campaigns@fieldnote.example'],
  ['Copperline Insurance', 'media@copperline.example'],
  ['Lumen Home', 'audio@lumenhome.example'],
  ['Mosaic Learning', 'partnerships@mosaiclearning.example'],
  ['Evergreen Energy', 'brand@evergreenenergy.example'],
  ['Foundry Software', 'growth@foundrysoftware.example'],
  ['Summit Outdoors', 'podcasts@summitoutdoors.example'],
  ['GoodDay Nutrition', 'media@gooddaynutrition.example'],
  ['Relay Workspace', 'campaigns@relayworkspace.example'],
  ['Atlas Automotive', 'audio@atlasauto.example'],
  ['Kindred Pet Co.', 'partnerships@kindredpet.example'],
  ['Crescent Cinema', 'brand@crescentcinema.example'],
];

function dateOffset(days) {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateBetween(startOffset, endOffset, fraction) {
  return dateOffset(Math.round(startOffset + (endOffset - startOffset) * fraction));
}

async function findOrCreateShow(client, orgId, title, category) {
  const found = await client.query(
    'SELECT id FROM shows WHERE organization_id = $1 AND title = $2',
    [orgId, title]
  );
  if (found.rows[0]) return found.rows[0].id;
  const created = await client.query(
    'INSERT INTO shows (organization_id, title, category) VALUES ($1, $2, $3) RETURNING id',
    [orgId, title, category]
  );
  return created.rows[0].id;
}

async function findOrCreateAdvertiser(client, orgId, name, contactEmail) {
  const found = await client.query(
    'SELECT id FROM advertisers WHERE organization_id = $1 AND name = $2',
    [orgId, name]
  );
  if (found.rows[0]) return found.rows[0].id;
  const created = await client.query(
    'INSERT INTO advertisers (organization_id, name, contact_email) VALUES ($1, $2, $3) RETURNING id',
    [orgId, name, contactEmail]
  );
  return created.rows[0].id;
}

async function findOrCreateCampaign(client, orgId, values) {
  const found = await client.query(
    'SELECT id FROM campaigns WHERE organization_id = $1 AND io_number = $2',
    [orgId, values.ioNumber]
  );
  if (found.rows[0]) return { id: found.rows[0].id, created: false };
  const inserted = await client.query(
    `INSERT INTO campaigns
      (organization_id, show_id, advertiser_id, io_number, status, start_date, end_date, committed_impressions, cpm)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      orgId,
      values.showId,
      values.advertiserId,
      values.ioNumber,
      values.status,
      values.startDate,
      values.endDate,
      values.committed,
      values.cpm,
    ]
  );
  return { id: inserted.rows[0].id, created: true };
}

export async function seedSampleWorkspace(client, orgId) {
  const showIds = [];
  for (let index = 0; index < SHOWS.length; index += 1) {
    const [title, category] = SHOWS[index];
    const showId = await findOrCreateShow(client, orgId, title, category);
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    await client.query(
      `UPDATE shows SET
         rss_url = COALESCE(rss_url, $1),
         network = COALESCE(network, $2),
         host = COALESCE(host, $3),
         description = COALESCE(description, $4),
         website_url = COALESCE(website_url, $5),
         language = COALESCE(language, 'en'),
         updated_at = NOW()
       WHERE id = $6`,
      [
        `https://feeds.example.com/${slug}.xml`,
        ['Northline Audio', 'Independent', 'Signal House', 'Civic Sound'][index % 4],
        ['Maya Chen', 'Jordan Brooks', 'Avery Morgan', 'Sam Rivera', 'Taylor Quinn'][index % 5],
        `${title} is a sample ${category.toLowerCase()} podcast used to demonstrate campaign reconciliation workflows.`,
        `https://podcasts.example.com/${slug}`,
        showId,
      ]
    );
    showIds.push(showId);
  }

  const advertiserIds = [];
  for (const [name, email] of ADVERTISERS) {
    advertiserIds.push(await findOrCreateAdvertiser(client, orgId, name, email));
  }

  const campaignRecords = [];
  for (let i = 0; i < 33; i += 1) {
    const invoiceReady = i < 15;
    const status = invoiceReady ? 'completed' : ['active', 'paused', 'draft'][(i - 15) % 3];
    const startOffset = invoiceReady ? -82 + (i % 8) : -24 + (i % 9);
    const endOffset = invoiceReady ? -12 - (i % 6) : 34 + (i % 17);
    const committed = 60000 + (i % 9) * 15000;
    const cpm = 18 + (i % 10) * 1.75;
    const ioNumber = `SAMPLE-${new Date().getUTCFullYear()}-${String(i + 1).padStart(3, '0')}`;
    const campaign = await findOrCreateCampaign(client, orgId, {
      showId: showIds[i % showIds.length],
      advertiserId: advertiserIds[(i * 7) % advertiserIds.length],
      ioNumber,
      status,
      startDate: dateOffset(startOffset),
      endDate: dateOffset(endOffset),
      committed,
      cpm,
    });
    campaignRecords.push({ ...campaign, showId: showIds[i % showIds.length], advertiserId: advertiserIds[(i * 7) % advertiserIds.length], ioNumber, invoiceReady, committed, cpm });

    const delivered = invoiceReady
      ? committed
      : status === 'active'
        ? Math.round(committed * (0.58 + (i % 4) * 0.07))
        : status === 'paused'
          ? Math.round(committed * 0.34)
          : 0;

    if (delivered > 0) {
      const firstDelivery = Math.floor(delivered * 0.48);
      const secondDelivery = delivered - firstDelivery;
      await client.query(
        `INSERT INTO delivery_records (campaign_id, date, impressions_delivered, source)
         VALUES ($1, $2, $3, 'sample_import'), ($1, $4, $5, 'sample_import')
         ON CONFLICT (campaign_id, date, source) DO NOTHING`,
        [
          campaign.id,
          dateBetween(startOffset, endOffset, 0.4),
          firstDelivery,
          dateBetween(startOffset, endOffset, 0.78),
          secondDelivery,
        ]
      );
    }

    const missingAircheck = !invoiceReady && i % 4 === 0;
    if (!missingAircheck && status !== 'draft') {
      await client.query(
        `INSERT INTO airchecks (campaign_id, episode_title, aircheck_url, notes)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (campaign_id, episode_title) DO NOTHING`,
        [
          campaign.id,
          `Sample episode ${String(i + 1).padStart(2, '0')}`,
          `https://example.com/airchecks/${ioNumber.toLowerCase()}`,
          invoiceReady ? 'Verified for billing' : 'Sample aircheck awaiting final review',
        ]
      );
    }

    if (!invoiceReady) {
      const issueType = missingAircheck
        ? 'missing_aircheck'
        : status === 'paused'
          ? 'discrepancy'
          : status === 'draft'
            ? 'under_delivery'
            : i % 2 === 0
              ? 'over_delivery'
              : 'under_delivery';
      const severity = i % 5 === 0 ? 'high' : i % 2 === 0 ? 'medium' : 'low';
      const description = `Sample alert ${String(i - 14).padStart(2, '0')}: ${issueType.replaceAll('_', ' ')} requires review`;
      const issue = await client.query(
        `INSERT INTO reconciliation_issues (campaign_id, type, severity, description, resolved)
         VALUES ($1, $2, $3, $4, false)
         ON CONFLICT (campaign_id, type, description) DO UPDATE SET resolved = false
         RETURNING id`,
        [campaign.id, issueType, severity, description]
      );
      if ((i - 15) % 4 === 0) {
        const makegoodImpressions = Math.max(2500, Math.round(committed * 0.05));
        await client.query(
          `INSERT INTO makegoods (campaign_id, issue_id, impressions_granted, value, status)
           VALUES ($1, $2, $3, $4, 'approved')
           ON CONFLICT (issue_id) DO NOTHING`,
          [campaign.id, issue.rows[0].id, makegoodImpressions, Number(((makegoodImpressions * cpm) / 1000).toFixed(2))]
        );
      }
    }

    if (campaign.created) {
      await client.query(
        `INSERT INTO activity_events (organization_id, entity_type, entity_id, action, details)
         VALUES ($1, 'campaign', $2, 'sample_created', $3)`,
        [orgId, campaign.id, JSON.stringify({ io_number: ioNumber })]
      );
    }
  }

  for (let showIndex = 0; showIndex < showIds.length; showIndex += 1) {
    const showId = showIds[showIndex];
    for (let episodeIndex = 0; episodeIndex < 3; episodeIndex += 1) {
      const episode = await client.query(
        `INSERT INTO episodes
          (show_id, guid, title, description, published_at, duration_seconds, audio_url, episode_number, season_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1)
         ON CONFLICT (show_id, guid) DO UPDATE SET title = EXCLUDED.title, updated_at = NOW()
         RETURNING id`,
        [
          showId,
          `sample:${showId}:${episodeIndex + 1}`,
          `${SHOWS[showIndex][0]} - Episode ${episodeIndex + 1}`,
          `Sample episode covering a timely ${SHOWS[showIndex][1].toLowerCase()} story.`,
          dateOffset(-(showIndex % 10) - episodeIndex * 7),
          1800 + ((showIndex + episodeIndex) % 6) * 300,
          `https://media.example.com/${showIndex + 1}/episode-${episodeIndex + 1}.mp3`,
          episodeIndex + 1,
        ]
      );
      const matchingCampaign = campaignRecords.find((record) => record.showId === showId);
      await client.query(
        `INSERT INTO ad_slots
          (episode_id, campaign_id, slot_type, position_seconds, duration_seconds, status, expected_impressions, delivered_impressions, aircheck_url, notes)
         VALUES ($1, $2, $3, $4, 60, $5, $6, $7, $8, $9)
         ON CONFLICT (episode_id, slot_type, position_seconds) DO UPDATE SET
           campaign_id = EXCLUDED.campaign_id,
           delivered_impressions = EXCLUDED.delivered_impressions,
           updated_at = NOW()`,
        [
          episode.rows[0].id,
          matchingCampaign?.id || null,
          episodeIndex === 0 ? 'pre_roll' : episodeIndex === 1 ? 'mid_roll' : 'post_roll',
          episodeIndex === 0 ? 30 : episodeIndex === 1 ? 840 : 1680,
          matchingCampaign ? 'verified' : 'planned',
          matchingCampaign ? Math.round(matchingCampaign.committed / 12) : 0,
          matchingCampaign ? Math.round(matchingCampaign.committed / 13) : 0,
          matchingCampaign ? `https://example.com/airchecks/${matchingCampaign.ioNumber.toLowerCase()}-${episodeIndex + 1}` : null,
          'Sample ad slot generated with the demo workspace.',
        ]
      );
    }
  }

  for (const record of campaignRecords.filter((campaign) => campaign.invoiceReady)) {
    const invoiceNumber = `SL-${record.ioNumber.replace(/[^A-Z0-9-]/gi, '')}`;
    await client.query(
      `INSERT INTO invoices
        (organization_id, campaign_id, invoice_number, recipient_email, status, amount, issued_at, due_at)
       SELECT $1, $2, $3, a.contact_email, $4, $5, NOW() - INTERVAL '5 days', NOW() + INTERVAL '25 days'
       FROM advertisers a WHERE a.id = $6
       ON CONFLICT (campaign_id) DO UPDATE SET amount = EXCLUDED.amount, updated_at = NOW()`,
      [orgId, record.id, invoiceNumber, record.id.endsWith('0') ? 'paid' : 'draft', Number(((record.committed * record.cpm) / 1000).toFixed(2)), record.advertiserId]
    );
  }

  const integrations = [
    ['Public RSS feed sync', 'Generic RSS', 'hosting'],
    ['Megaphone hosting', 'Megaphone', 'hosting'],
    ['Acast hosting', 'Acast', 'hosting'],
    ['ART19 hosting', 'ART19', 'hosting'],
    ['Captivate hosting', 'Captivate', 'hosting'],
    ['Buzzsprout hosting', 'Buzzsprout', 'hosting'],
    ['Transistor hosting', 'Transistor', 'hosting'],
    ['Simplecast hosting', 'Simplecast', 'hosting'],
    ['AdsWizz delivery API', 'AdsWizz', 'ad_server'],
    ['Triton delivery API', 'Triton Digital', 'ad_server'],
    ['Megaphone delivery API', 'Megaphone', 'ad_server'],
    ['Generic delivery webhook', 'Generic JSON', 'ad_server'],
    ['SendGrid invoice email', 'SendGrid SMTP', 'email'],
    ['Mailgun invoice email', 'Mailgun SMTP', 'email'],
    ['Amazon SES invoice email', 'Amazon SES SMTP', 'email'],
  ];
  for (const [name, provider, type] of integrations) {
    await client.query(
      `INSERT INTO provider_integrations (organization_id, name, provider, integration_type, status)
       VALUES ($1, $2, $3, $4, 'paused')
       ON CONFLICT (organization_id, name) DO NOTHING`,
      [orgId, name, provider, type]
    );
  }

  for (const record of campaignRecords.filter((campaign) => !campaign.invoiceReady).slice(0, 15)) {
    const alertType = record.id.charCodeAt(0) % 3 === 0 ? 'missing_aircheck' : record.id.charCodeAt(0) % 2 === 0 ? 'campaign_deadline' : 'under_delivery';
    await client.query(
      `INSERT INTO alerts (organization_id, campaign_id, alert_type, severity, title, message, status, due_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'open', $7)
       ON CONFLICT (organization_id, campaign_id, alert_type, title) WHERE campaign_id IS NOT NULL
       DO UPDATE SET message = EXCLUDED.message, updated_at = NOW()`,
      [
        orgId,
        record.id,
        alertType,
        alertType === 'campaign_deadline' ? 'high' : 'medium',
        `${record.ioNumber}: ${alertType.replaceAll('_', ' ')}`,
        `Review ${record.ioNumber}; automated monitoring detected ${alertType.replaceAll('_', ' ')}.`,
        dateOffset(7),
      ]
    );
  }

  const counts = await client.query(
    `SELECT
       (SELECT COUNT(*)::int FROM shows WHERE organization_id = $1) AS shows,
       (SELECT COUNT(*)::int FROM advertisers WHERE organization_id = $1) AS advertisers,
       (SELECT COUNT(*)::int FROM campaigns WHERE organization_id = $1) AS campaigns,
       (SELECT COUNT(*)::int FROM reconciliation_issues ri JOIN campaigns c ON c.id = ri.campaign_id WHERE c.organization_id = $1) AS issues,
       (SELECT COUNT(*)::int FROM invoices WHERE organization_id = $1) AS invoices,
       (SELECT COUNT(*)::int FROM episodes e JOIN shows s ON s.id = e.show_id WHERE s.organization_id = $1) AS episodes,
       (SELECT COUNT(*)::int FROM alerts WHERE organization_id = $1) AS alerts
    `,
    [orgId]
  );
  return counts.rows[0];
}
