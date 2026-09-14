require('dotenv').config();

const express = require('express');
const path = require('path');
const pino = require('pino');

const { isDatabaseConfigured, query } = require('./db');
const { checkWhatsAppNumber, getQRCode, isBotConnected, startBot } = require('./bot');
const { normalizePhone } = require('./scraper');
const { DEFAULT_OSM_CATEGORIES, discoverOsmBusinesses, geocodeOsm } = require('./osmDiscovery');

const app = express();
const logger = pino({
  level: process.env.LOG_LEVEL || 'info'
});

const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use('/assets', express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0
}));

function parseLimit(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return Boolean(value);
}

function requireAdminSecret(req, res, next) {
  const providedSecret = req.headers.secret || req.headers['x-admin-secret'] || req.body?.secret;
  const normalizedProvidedSecret = providedSecret === undefined || providedSecret === null
    ? ''
    : String(providedSecret).trim();
  const normalizedAdminSecret = String(process.env.ADMIN_SECRET || '').trim();

  if (!normalizedAdminSecret) {
    return res.status(500).json({ error: 'ADMIN_SECRET is not configured on the server.' });
  }

  if (normalizedProvidedSecret !== normalizedAdminSecret) {
    return res.status(401).json({ error: 'Invalid or missing admin secret.' });
  }

  return next();
}

function htmlPage({ title, bodyClass = '', body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  <link rel="stylesheet" href="/assets/styles.css">
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script src="/assets/app.js" defer></script>
</head>
<body class="${bodyClass}">
${body}
</body>
</html>`;
}

function normalizeDiscoveredPhone(phone) {
  const normalized = normalizePhone(phone);
  if (normalized) return normalized;
  return phone ? String(phone).replace(/[^\d+]/g, '').slice(0, 50) : null;
}

async function leadStats() {
  if (!isDatabaseConfigured()) {
    return {
      total: 0,
      shortlisted: 0,
      discovered: 0,
      with_phone: 0,
      with_website: 0,
      pending: 0,
      replied: 0,
      migrated: 0,
      rejected: 0,
      bot_active: 0,
      muted: 0
    };
  }

  const result = await query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE shortlisted = TRUE)::int AS shortlisted,
      COUNT(*) FILTER (WHERE source = 'OSM_OVERPASS')::int AS discovered,
      COUNT(*) FILTER (WHERE whatsapp_number IS NOT NULL OR (phone IS NOT NULL AND phone NOT LIKE 'place:%' AND phone NOT LIKE 'osm:%'))::int AS with_phone,
      COUNT(*) FILTER (WHERE website IS NOT NULL)::int AS with_website,
      COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending,
      COUNT(*) FILTER (WHERE status = 'REPLIED')::int AS replied,
      COUNT(*) FILTER (WHERE status = 'MIGRATED')::int AS migrated,
      COUNT(*) FILTER (WHERE status = 'REJECTED')::int AS rejected,
      COUNT(*) FILTER (WHERE bot_active = TRUE)::int AS bot_active,
      COUNT(*) FILTER (WHERE bot_active = FALSE)::int AS muted
    FROM leads
  `);

  return result.rows[0];
}

async function saveOsmLead(lead, discoveryQuery, shortlisted) {
  if (!isDatabaseConfigured()) {
    return {
      ...lead,
      id: null,
      shortlisted,
      status: 'PENDING',
      bot_active: false,
      discovery_query: discoveryQuery
    };
  }

  const storedPhone = lead.whatsapp_number || normalizeDiscoveredPhone(lead.phone) || `osm:${lead.osm_type}:${lead.osm_id}`;
  const existing = await query(
    'SELECT id FROM leads WHERE (osm_type = $1 AND osm_id = $2) OR phone = $3 OR whatsapp_number = $3 LIMIT 1',
    [lead.osm_type, lead.osm_id, storedPhone]
  );
  const values = [
    lead.store_name,
    storedPhone,
    lead.area,
    lead.category,
    lead.address,
    lead.website,
    lead.google_maps_url,
    lead.osm_type,
    lead.osm_id,
    lead.osm_url,
    lead.whatsapp_number,
    lead.whatsapp_url,
    lead.whatsapp_available,
    lead.whatsapp_check_method,
    lead.distance_km,
    lead.business_status,
    lead.rating,
    lead.review_count,
    lead.latitude,
    lead.longitude,
    discoveryQuery,
    JSON.stringify(lead.social_links || {}),
    JSON.stringify(lead.profile_data || {}),
    lead.lead_score,
    shortlisted
  ];

  if (existing.rows[0]) {
    values.push(existing.rows[0].id);
    const result = await query(
      `UPDATE leads SET
        store_name = $1,
        phone = $2,
        area = $3,
        category = $4,
        address = $5,
        website = $6,
        google_maps_url = $7,
        osm_type = $8,
        osm_id = $9,
        osm_url = $10,
        whatsapp_number = $11,
        whatsapp_url = $12,
        whatsapp_available = $13,
        whatsapp_check_method = $14,
        distance_km = $15,
        business_status = $16,
        rating = $17,
        review_count = $18,
        latitude = $19,
        longitude = $20,
        source = 'OSM_OVERPASS',
        discovery_query = $21,
        social_links = $22::jsonb,
        profile_data = $23::jsonb,
        lead_score = $24,
        shortlisted = $25,
        bot_active = FALSE,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $26
      RETURNING id, store_name, phone, area, category, address, website, google_maps_url,
        osm_type, osm_id, osm_url, whatsapp_number, whatsapp_url, whatsapp_available,
        whatsapp_check_method, distance_km, business_status, rating, review_count,
        social_links, lead_score, shortlisted, status, bot_active, created_at, updated_at`,
      values
    );
    return result.rows[0];
  }

  const result = await query(
    `INSERT INTO leads (
      store_name, phone, area, category, address, website, google_maps_url,
      osm_type, osm_id, osm_url, whatsapp_number, whatsapp_url, whatsapp_available,
      whatsapp_check_method, distance_km, business_status, rating, review_count,
      latitude, longitude, source, discovery_query, social_links, profile_data,
      lead_score, shortlisted, bot_active
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
      'OSM_OVERPASS', $21, $22::jsonb, $23::jsonb, $24, $25, FALSE
    )
    RETURNING id, store_name, phone, area, category, address, website, google_maps_url,
      osm_type, osm_id, osm_url, whatsapp_number, whatsapp_url, whatsapp_available,
      whatsapp_check_method, distance_km, business_status, rating, review_count,
      social_links, lead_score, shortlisted, status, bot_active, created_at, updated_at`,
    values
  );

  return result.rows[0];
}

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(htmlPage({
    title: 'Lead Engine Research Console',
    bodyClass: 'app-shell',
    body: `
  <header class="topbar">
    <div>
      <p class="eyebrow">Lead Engine</p>
      <h1>Business Lead Research</h1>
    </div>
    <div class="topbar-actions">
      <a class="button ghost" href="/qr">QR</a>
      <a class="button ghost" href="/health">Health</a>
    </div>
  </header>

  <main class="layout">
    <section class="panel hero-panel">
      <div>
        <p class="eyebrow">Manual Outreach Mode</p>
        <h2>Click map, scan a radius, verify WhatsApp candidates, then message manually.</h2>
      </div>
      <div class="status-strip">
        <div class="metric">
          <span id="waStatus" class="status-dot"></span>
          <small>WhatsApp</small>
          <strong id="waText">Checking</strong>
        </div>
        <div class="metric">
          <small>Auto Reply</small>
          <strong id="autoReplyText">Off</strong>
        </div>
        <div class="metric">
          <small>Shortlisted</small>
          <strong id="shortlistCount">0</strong>
        </div>
      </div>
    </section>

    <section class="stats-grid" id="statsGrid" aria-live="polite"></section>

    <section class="workspace-grid">
      <article class="panel qr-panel">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Map Search</p>
            <h2>Pick Location</h2>
          </div>
          <button class="mini-button" data-action="refresh" title="Refresh dashboard">Refresh</button>
        </div>
        <div class="map-search">
          <input id="placeSearch" placeholder="Search area, e.g. Gulberg Lahore">
          <button class="mini-button" id="searchPlaceButton" type="button">Find</button>
        </div>
        <div id="map" class="map-canvas"></div>
        <p class="map-meta" id="mapMeta">Click the map to select a 5km area.</p>
      </article>

      <article class="panel">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Discovery</p>
            <h2>Find Best 10</h2>
          </div>
        </div>
        <form id="discoveryForm" class="form-stack">
          <label>Admin Secret<input name="secret" type="password" required placeholder="ADMIN_SECRET"></label>
          <label>Latitude<input name="latitude" id="latitudeInput" required readonly placeholder="Click map"></label>
          <label>Longitude<input name="longitude" id="longitudeInput" required readonly placeholder="Click map"></label>
          <label>Radius KM <span id="radiusValue">5</span><input name="radius_km" id="radiusInput" type="range" min="1" max="25" value="5"></label>
          <label>Business Categories<input name="categories" placeholder="restaurant,gym,dentist,salon,retail"></label>
          <label>Lookup Limit<input name="limit" type="number" min="1" max="100" value="10"></label>
          <label class="checkline"><input name="verify_whatsapp" type="checkbox" checked> Verify with connected WhatsApp when available</label>
          <button class="button primary" type="submit">Discover Leads</button>
        </form>
        <div id="discoveryResult" class="notice" hidden></div>
      </article>

      <article class="panel">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Manual Add</p>
            <h2>Add Known Lead</h2>
          </div>
        </div>
        <form id="leadForm" class="form-stack">
          <label>Business Name<input name="store_name" required placeholder="Dental Care Clinic"></label>
          <label>Phone<input name="phone" required placeholder="03001234567"></label>
          <label>Area<input name="area" placeholder="Lahore"></label>
          <button class="button primary" type="submit">Save Lead</button>
        </form>
        <div id="leadResult" class="notice" hidden></div>
      </article>
    </section>

    <section class="panel">
      <div class="section-heading table-heading">
        <div>
          <p class="eyebrow">Review Desk</p>
          <h2>Business Profiles</h2>
        </div>
        <div class="filters">
          <input id="opsSecret" type="password" placeholder="Admin secret">
          <select id="statusFilter" aria-label="Status filter">
            <option value="">All statuses</option>
            <option>PENDING</option>
            <option>REPLIED</option>
            <option>MIGRATED</option>
            <option>REJECTED</option>
          </select>
          <input id="searchFilter" placeholder="Search name, phone, area">
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Business</th>
              <th>Category</th>
              <th>Score</th>
              <th>Reviews</th>
              <th>Phone</th>
              <th>WhatsApp</th>
              <th>Website/Social</th>
              <th>Address</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="leadRows"></tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Top 10</p>
          <h2>Shortlisted Records</h2>
        </div>
      </div>
      <div id="hotLeads" class="hot-list"></div>
    </section>
  </main>
  <div class="modal" id="recordModal" hidden>
    <div class="modal-card">
      <button class="modal-close" id="recordClose" type="button">Close</button>
      <div id="recordBody"></div>
    </div>
  </div>`
  }));
});

app.get('/qr', (req, res) => {
  const qr = getQRCode();

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(htmlPage({
    title: 'WhatsApp QR - Lead Engine',
    bodyClass: 'qr-page',
    body: `
  <main class="pairing-card">
    <p class="eyebrow">Lead Engine</p>
    <h1>WhatsApp Pairing</h1>
    <div class="qr-box large">
      ${qr ? `<img src="${qr}" alt="WhatsApp QR code">` : '<p>No QR available. WhatsApp may already be connected, or the bot is still starting. Refresh in a few seconds.</p>'}
    </div>
    <a class="button ghost" href="/">Open Console</a>
  </main>`
  }));
});

app.get('/health', (req, res) => {
  res.json({
    name: 'lead-engine',
    status: 'ok',
    mode: 'manual_research',
    whatsapp_connected: isBotConnected(),
    qr_available: Boolean(getQRCode()),
    auto_reply_enabled: process.env.ENABLE_AUTO_REPLY === 'true',
    database_configured: isDatabaseConfigured(),
    routes: {
      console: 'GET /',
      qr: 'GET /qr',
      status: 'GET /api/status',
      osmGeocode: 'GET /api/osm/geocode?q=Gulberg Lahore',
      osmDiscover: 'POST /api/discovery/osm',
      leads: 'GET /api/leads',
      ingestLeads: 'POST /api/leads/batch',
      updateLead: 'PATCH /api/leads/:id',
      shortlisted: 'GET /api/leads/shortlisted',
      disabledCampaign: 'POST /api/campaign/trigger'
    }
  });
});

app.get('/api/status', async (req, res) => {
  try {
    const stats = await leadStats();

    res.json({
      name: 'lead-engine',
      mode: 'manual_research',
      whatsapp_connected: isBotConnected(),
      qr_available: Boolean(getQRCode()),
      auto_reply_enabled: process.env.ENABLE_AUTO_REPLY === 'true',
      database_configured: isDatabaseConfigured(),
      default_osm_categories: DEFAULT_OSM_CATEGORIES,
      stats
    });
  } catch (error) {
    logger.error({ error: error.message }, '[API] Status query failed.');
    res.status(500).json({ error: 'Failed to fetch status.' });
  }
});

app.get('/api/qr', (req, res) => {
  res.json({
    qr: getQRCode(),
    whatsapp_connected: isBotConnected()
  });
});

app.get('/api/osm/geocode', async (req, res) => {
  const place = req.query.q ? String(req.query.q).trim() : '';

  if (!place) {
    return res.status(400).json({ error: 'Search query is required.' });
  }

  try {
    const result = await geocodeOsm(place);
    return res.json(result);
  } catch (error) {
    logger.error({ error: error.message }, '[API] OSM geocode failed.');
    return res.status(500).json({ error: error.message || 'OSM geocode failed.' });
  }
});

app.get('/api/leads', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return res.json({ count: 0, leads: [] });
  }

  const status = req.query.status ? String(req.query.status).trim().toUpperCase() : null;
  const area = req.query.area ? String(req.query.area).trim() : null;
  const search = req.query.search ? `%${String(req.query.search).trim()}%` : null;
  const limit = parseLimit(req.query.limit, 50, 200);
  const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);

  try {
    const params = [];
    const where = [];

    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }

    if (area) {
      params.push(area);
      where.push(`area = $${params.length}`);
    }

    if (req.query.shortlisted !== undefined) {
      params.push(parseBoolean(req.query.shortlisted));
      where.push(`shortlisted = $${params.length}`);
    }

    if (search) {
      params.push(search);
      where.push(`(store_name ILIKE $${params.length} OR phone ILIKE $${params.length} OR area ILIKE $${params.length} OR category ILIKE $${params.length})`);
    }

    params.push(limit);
    const limitPlaceholder = `$${params.length}`;
    params.push(offset);
    const offsetPlaceholder = `$${params.length}`;
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const result = await query(
      `SELECT id, store_name, phone, area, category, address, website, google_maps_url,
        osm_type, osm_id, osm_url, whatsapp_number, whatsapp_url, whatsapp_available,
        whatsapp_check_method, distance_km, business_status, rating, review_count, social_links, lead_score, shortlisted,
        status, bot_active, last_message, created_at, updated_at
       FROM leads
       ${whereClause}
       ORDER BY shortlisted DESC, lead_score DESC, updated_at DESC, created_at DESC
       LIMIT ${limitPlaceholder}
       OFFSET ${offsetPlaceholder}`,
      params
    );

    res.json({
      count: result.rows.length,
      leads: result.rows
    });
  } catch (error) {
    logger.error({ error: error.message }, '[API] Leads query failed.');
    res.status(500).json({ error: 'Failed to fetch leads.' });
  }
});

app.get('/api/leads/shortlisted', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return res.json({ count: 0, leads: [] });
  }

  try {
    const result = await query(
      `SELECT id, store_name, phone, area, category, address, website, google_maps_url,
        osm_type, osm_id, osm_url, whatsapp_number, whatsapp_url, whatsapp_available,
        whatsapp_check_method, distance_km, business_status, rating, review_count, social_links, lead_score, shortlisted,
        status, bot_active, last_message, created_at, updated_at
       FROM leads
       WHERE shortlisted = TRUE
       ORDER BY lead_score DESC, updated_at DESC
       LIMIT 25`
    );

    res.json({
      count: result.rows.length,
      leads: result.rows
    });
  } catch (error) {
    logger.error({ error: error.message }, '[API] Shortlist query failed.');
    res.status(500).json({ error: 'Failed to fetch shortlisted leads.' });
  }
});

app.post('/api/discovery/osm', requireAdminSecret, async (req, res) => {
  const latitude = Number(req.body?.latitude);
  const longitude = Number(req.body?.longitude);
  const radiusKm = parseLimit(req.body?.radius_km || req.body?.radiusKm, 5, 25);
  const limit = parseLimit(req.body?.limit, 10, 100);
  const categories = req.body?.categories || DEFAULT_OSM_CATEGORIES;
  const verifyWhatsapp = req.body?.verify_whatsapp === undefined ? true : parseBoolean(req.body.verify_whatsapp);

  try {
    const discovery = await discoverOsmBusinesses({
      latitude,
      longitude,
      radiusKm,
      categories,
      limit
    });

    const verified = [];
    for (const lead of discovery.leads) {
      if (verifyWhatsapp && isBotConnected()) {
        const check = await checkWhatsAppNumber(lead.whatsapp_number);
        lead.whatsapp_available = check.available;
        lead.whatsapp_check_method = check.method;
        if (check.jid) lead.profile_data.whatsapp_jid = check.jid;
      } else {
        lead.whatsapp_available = null;
        lead.whatsapp_check_method = isBotConnected() ? 'not_requested' : 'mobile_candidate_not_verified';
      }

      if (lead.whatsapp_available !== false) {
        verified.push(lead);
      }
    }

    const discoveryQuery = JSON.stringify({
      source: 'OSM_OVERPASS',
      latitude,
      longitude,
      radius_km: radiusKm,
      limit,
      categories: Array.isArray(categories) ? categories : String(categories).split(',').map((item) => item.trim()).filter(Boolean),
      verify_whatsapp: verifyWhatsapp
    });

    const saved = [];
    for (const lead of verified) {
      saved.push(await saveOsmLead(lead, discoveryQuery, true));
    }

    return res.status(201).json({
      ...discovery,
      whatsapp_verified_count: verified.filter((lead) => lead.whatsapp_available === true).length,
      saved_count: saved.length,
      leads: saved
    });
  } catch (error) {
    logger.error({ error: error.message }, '[API] OSM discovery failed.');
    return res.status(500).json({ error: error.message || 'OSM discovery failed.' });
  }
});

app.post('/api/leads/batch', async (req, res) => {
  if (!isDatabaseConfigured()) {
    return res.status(503).json({ error: 'DATABASE_URL is required before saving leads.' });
  }

  const leads = Array.isArray(req.body?.leads) ? req.body.leads : req.body;

  if (!Array.isArray(leads) || leads.length === 0) {
    return res.status(400).json({ error: 'Request body must include a non-empty leads array.' });
  }

  const inserted = [];
  const skipped = [];

  for (const lead of leads) {
    const storeName = String(lead.store_name || '').trim();
    const phone = normalizePhone(lead.phone);
    const area = lead.area ? String(lead.area).trim() : null;

    if (!storeName || !phone) {
      skipped.push({ lead, reason: 'Missing business name or valid Pakistani phone number.' });
      continue;
    }

    try {
      const result = await query(
        `INSERT INTO leads (store_name, phone, area, bot_active)
         VALUES ($1, $2, $3, FALSE)
         ON CONFLICT (phone) DO NOTHING
         RETURNING id, store_name, phone, area, status, bot_active, created_at, updated_at`,
        [storeName, phone, area]
      );

      if (result.rows[0]) {
        inserted.push(result.rows[0]);
      } else {
        skipped.push({ store_name: storeName, phone, reason: 'Duplicate phone.' });
      }
    } catch (error) {
      logger.error({ error: error.message, phone }, '[API] Lead insert failed.');
      skipped.push({ store_name: storeName, phone, reason: error.message });
    }
  }

  return res.status(201).json({
    inserted_count: inserted.length,
    skipped_count: skipped.length,
    inserted,
    skipped
  });
});

app.patch('/api/leads/:id', requireAdminSecret, async (req, res) => {
  if (!isDatabaseConfigured()) {
    return res.status(503).json({ error: 'DATABASE_URL is required before updating leads.' });
  }

  const leadId = Number.parseInt(req.params.id, 10);
  const allowedStatuses = new Set(['PENDING', 'INITIATED', 'REPLIED', 'MIGRATED', 'REJECTED']);
  const fields = [];
  const params = [];

  if (!Number.isInteger(leadId)) {
    return res.status(400).json({ error: 'Invalid lead id.' });
  }

  const scalarFields = ['store_name', 'area', 'category', 'address', 'website', 'google_maps_url', 'last_message'];
  for (const field of scalarFields) {
    if (req.body[field] !== undefined) {
      params.push(req.body[field] ? String(req.body[field]).trim() : null);
      fields.push(`${field} = $${params.length}`);
    }
  }

  if (req.body.phone !== undefined) {
    const phone = normalizePhone(req.body.phone);
    if (!phone) return res.status(400).json({ error: 'Invalid Pakistani phone number.' });
    params.push(phone);
    fields.push(`phone = $${params.length}`);
  }

  if (req.body.status !== undefined) {
    const status = String(req.body.status).trim().toUpperCase();
    if (!allowedStatuses.has(status)) return res.status(400).json({ error: 'Invalid lead status.' });
    params.push(status);
    fields.push(`status = $${params.length}`);
  }

  if (req.body.bot_active !== undefined) {
    params.push(parseBoolean(req.body.bot_active));
    fields.push(`bot_active = $${params.length}`);
  }

  if (req.body.shortlisted !== undefined) {
    params.push(parseBoolean(req.body.shortlisted));
    fields.push(`shortlisted = $${params.length}`);
  }

  if (!fields.length) {
    return res.status(400).json({ error: 'No supported fields provided.' });
  }

  params.push(leadId);

  try {
    const result = await query(
      `UPDATE leads
       SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${params.length}
       RETURNING id, store_name, phone, area, category, address, website, google_maps_url,
        osm_type, osm_id, osm_url, whatsapp_number, whatsapp_url, whatsapp_available,
        whatsapp_check_method, distance_km, business_status, rating, review_count, social_links, lead_score, shortlisted,
        status, bot_active, last_message, created_at, updated_at`,
      params
    );

    if (!result.rows[0]) return res.status(404).json({ error: 'Lead not found.' });
    return res.json({ lead: result.rows[0] });
  } catch (error) {
    logger.error({ error: error.message, leadId }, '[API] Lead update failed.');
    return res.status(500).json({ error: 'Failed to update lead.' });
  }
});

app.post('/api/campaign/trigger', (req, res) => {
  res.status(410).json({
    error: 'Automated campaign sending is disabled. Use discovery and manually message shortlisted businesses.'
  });
});

app.listen(PORT, () => {
  logger.info(`[SERVER] lead-engine research console listening on port ${PORT}`);
});

startBot().catch((error) => {
  logger.error({ error: error.message }, '[BOT] Failed to start WhatsApp bot.');
});
