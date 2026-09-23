require('dotenv').config();

const dns = require('dns');
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

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
  const providedSecret = req.headers.secret
    || req.headers['x-admin-secret']
    || req.body?.secret
    || req.query?.secret;

  const normalizedProvidedSecret = providedSecret === undefined || providedSecret === null
    ? ''
    : String(providedSecret).trim();

  const normalizedAdminSecret = String(process.env.ADMIN_SECRET || '7940').trim();

  if (!normalizedProvidedSecret) {
    return res.status(401).json({ error: 'Access PIN / Secret required.' });
  }

  if (normalizedProvidedSecret !== normalizedAdminSecret && normalizedProvidedSecret !== '7940') {
    return res.status(401).json({ error: 'ACCESS DENIED: Invalid Security PIN.' });
  }

  return next();
}

function htmlPage({ title }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <title>${title}</title>
  <link rel="icon" type="image/jpeg" href="/assets/hacker.jpg">
  <link rel="shortcut icon" href="/assets/hacker.jpg">
  <link rel="apple-touch-icon" href="/assets/hacker.jpg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  <link rel="stylesheet" href="/assets/styles.css">
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
  <script src="/assets/app.js" defer></script>
</head>
<body class="studio-shell">

  <!-- ==================== STUDIO SECURITY PIN GATE ==================== -->
  <section class="pin-overlay" id="pinGate" aria-modal="true" role="dialog">
    <div class="studio-vault-card">
      <div class="pin-card-header">
        <div class="studio-logo-badge">
          <span class="studio-badge-icon">✦</span>
        </div>
        <p class="studio-pill-tag">SECURE WORKSPACE</p>
        <h1 class="studio-login-title">Lead Studio</h1>
        <p class="pin-hint">Enter 4-digit security PIN to unlock workspace</p>
      </div>

      <!-- Desktop 4-Box Inputs -->
      <div class="desktop-pin-wrapper" id="desktopPinWrapper">
        <div class="desktop-pin-inputs" id="desktopPinInputs">
          <input type="password" maxlength="1" class="pin-box" id="pinBox1" data-index="0" autofocus inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="•">
          <input type="password" maxlength="1" class="pin-box" id="pinBox2" data-index="1" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="•">
          <input type="password" maxlength="1" class="pin-box" id="pinBox3" data-index="2" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="•">
          <input type="password" maxlength="1" class="pin-box" id="pinBox4" data-index="3" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="•">
        </div>
      </div>

      <!-- Mobile PIN Dots -->
      <div class="mobile-pin-display" id="mobilePinDisplay">
        <div class="pin-dot" id="pDot1"></div>
        <div class="pin-dot" id="pDot2"></div>
        <div class="pin-dot" id="pDot3"></div>
        <div class="pin-dot" id="pDot4"></div>
      </div>

      <input type="password" id="pinHiddenInput" maxlength="4" inputmode="numeric" pattern="[0-9]*" class="pin-hidden-input" autocomplete="off">

      <!-- Mobile Keypad Grid -->
      <div class="keypad-grid" id="keypadGrid">
        <button type="button" class="key-btn" data-key="1">1</button>
        <button type="button" class="key-btn" data-key="2">2</button>
        <button type="button" class="key-btn" data-key="3">3</button>
        <button type="button" class="key-btn" data-key="4">4</button>
        <button type="button" class="key-btn" data-key="5">5</button>
        <button type="button" class="key-btn" data-key="6">6</button>
        <button type="button" class="key-btn" data-key="7">7</button>
        <button type="button" class="key-btn" data-key="8">8</button>
        <button type="button" class="key-btn" data-key="9">9</button>
        <button type="button" class="key-btn action-key" data-key="clear" title="Clear PIN">CLR</button>
        <button type="button" class="key-btn" data-key="0">0</button>
        <button type="button" class="key-btn action-key unlock-btn" data-key="enter" title="Authenticate">↵</button>
      </div>

      <div class="pin-status-msg" id="pinStatusMsg"></div>
      <div class="pin-footer-info">
        <span>DEFAULT PIN: 7940</span>
        <span>LEAD STUDIO V2.5</span>
      </div>
    </div>
  </section>

  <!-- ==================== MAIN STUDIO WORKSPACE (UNLOCKED) ==================== -->
  <div class="master-hud" id="masterHud" hidden>

    <!-- Clipchamp-Style Studio Topbar -->
    <header class="hud-topbar">
      <div class="hud-brand">
        <div class="studio-logo-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
          </svg>
        </div>
        <div class="brand-text">
          <div class="brand-title-row">
            <h1 class="hud-title">LEAD STUDIO</h1>
            <span class="pro-badge">PRO</span>
          </div>
          <span class="hud-sub">Local Outreach & WhatsApp Validator</span>
        </div>
      </div>

      <div class="studio-center-status">
        <span class="status-pulse-dot"></span>
        <span class="status-pulse-text">OVERPASS GEO ENGINE READY</span>
      </div>

      <div class="hud-telemetry">
        <button class="hud-btn" id="soundToggleBtn" type="button" title="Toggle Audio Feedback">
          <span class="icon">🔊</span> <span class="txt">AUDIO ON</span>
        </button>
        <div class="telemetry-pill">
          <span class="node-label">SYS</span>
          <span class="node-val font-mono" id="cyberClock">00:00:00 UTC</span>
        </div>
        <button class="hud-btn hud-lock-btn" id="lockConsoleBtn" type="button" title="Lock Studio">
          <span class="lock-icon">🔒</span> LOCK
        </button>
      </div>
    </header>

    <!-- Main Dynamic Studio Canvas -->
    <main class="hud-main">

      <!-- Studio Metrics Bar -->
      <section class="studio-card hero-strip" id="heroStrip">
        <div class="hero-left">
          <div class="hero-tag-wrap">
            <span class="studio-pill-tag purple">GEO RADIUS INTELLIGENCE</span>
          </div>
          <h2 class="hero-heading">Local Business Outreach & WhatsApp Validator</h2>
          <p class="hero-caption">High-precision local business discovery via OpenStreetMap Overpass with instant WhatsApp direct messaging.</p>
        </div>
        <div class="hero-metrics">
          <div class="metric-card">
            <div class="metric-header">
              <span class="metric-icon">🏢</span>
              <small>TOTAL LEADS</small>
            </div>
            <strong id="statTotal" class="metric-value">0</strong>
          </div>
          <div class="metric-card">
            <div class="metric-header">
              <span class="metric-icon star">★</span>
              <small>SHORTLISTED</small>
            </div>
            <strong id="statShortlisted" class="metric-value highlight-purple">0</strong>
          </div>
          <div class="metric-card">
            <div class="metric-header">
              <span class="metric-icon">📞</span>
              <small>WITH PHONE</small>
            </div>
            <strong id="statWithPhone" class="metric-value">0</strong>
          </div>
          <div class="metric-card">
            <div class="metric-header">
              <span class="metric-icon green">💬</span>
              <small>VERIFIED WA</small>
            </div>
            <strong id="statVerifiedWA" class="metric-value highlight-green">0</strong>
          </div>
        </div>
      </section>

      <!-- 3-Panel Studio Control Deck -->
      <section class="studio-grid-3">
        <!-- Panel 1: Target Location & Interactive Map -->
        <article class="studio-card map-panel">
          <div class="panel-header">
            <div class="panel-title-wrap">
              <span class="panel-icon">📍</span>
              <h3>Target Location & Area Map</h3>
            </div>
            <button class="studio-btn sm" data-action="refresh" title="Sync Records">
              <span>↻</span> SYNC
            </button>
          </div>
          <div class="map-search-bar">
            <input id="placeSearch" class="studio-input" placeholder="Search area or city (e.g. Gulberg Lahore)">
            <button class="studio-btn primary sm" id="searchPlaceButton" type="button">SEARCH</button>
          </div>
          <div id="map" class="map-studio-canvas"></div>
          <p class="map-meta-info" id="mapMeta">Click anywhere on the map to set scan coordinates.</p>
        </article>

        <!-- Panel 2: Discovery Engine Form -->
        <article class="studio-card">
          <div class="panel-header">
            <div class="panel-title-wrap">
              <span class="panel-icon purple">✦</span>
              <h3>Radius Discovery Engine</h3>
            </div>
          </div>
          <form id="discoveryForm" class="studio-form-stack">
            <div class="form-row-2">
              <label class="form-label">Latitude
                <input name="latitude" id="latitudeInput" class="studio-input font-mono" required readonly placeholder="Lat">
              </label>
              <label class="form-label">Longitude
                <input name="longitude" id="longitudeInput" class="studio-input font-mono" required readonly placeholder="Lon">
              </label>
            </div>
            <div class="form-row-2">
              <label class="form-label">Radius: <span id="radiusValue" class="text-purple font-mono font-bold">5</span> KM
                <input name="radius_km" id="radiusInput" type="range" min="1" max="25" value="5" class="studio-range">
              </label>
              <label class="form-label">Result Limit
                <input name="limit" type="number" min="1" max="100" value="10" class="studio-input">
              </label>
            </div>
            <label class="form-label">Business Categories
              <input name="categories" class="studio-input" placeholder="restaurant,gym,dentist,salon,retail">
            </label>
            <label class="studio-checkline">
              <input name="verify_whatsapp" type="checkbox" checked>
              <span>Verify WhatsApp connectivity & availability</span>
            </label>
            <button class="studio-btn primary full glow-btn" type="submit" id="btnDiscoverLeads">
              <span>✨</span> DISCOVER LOCAL LEADS
            </button>
          </form>
          <div id="discoveryResult" class="studio-notice" hidden></div>
        </article>

        <!-- Panel 3: Quick Manual Entry -->
        <article class="studio-card">
          <div class="panel-header">
            <div class="panel-title-wrap">
              <span class="panel-icon">＋</span>
              <h3>Quick Lead Capture</h3>
            </div>
          </div>
          <form id="leadForm" class="studio-form-stack">
            <label class="form-label">Business / Client Name
              <input name="store_name" class="studio-input" required placeholder="Prime Dental Clinic">
            </label>
            <label class="form-label">Phone Number
              <input name="phone" class="studio-input font-mono" required placeholder="03001234567">
            </label>
            <label class="form-label">Area / Location
              <input name="area" class="studio-input" placeholder="Lahore">
            </label>
            <button class="studio-btn full" type="submit">
              <span>＋</span> SAVE RECORD
            </button>
          </form>
          <div id="leadResult" class="studio-notice" hidden></div>
        </article>
      </section>

      <!-- Top Shortlisted Records -->
      <section class="studio-card mt-4">
        <div class="panel-header">
          <div class="panel-title-wrap">
            <span class="studio-pill-tag amber">★ HIGH PRIORITY</span>
            <h3>Top Shortlisted Candidates</h3>
          </div>
        </div>
        <div id="hotLeads" class="hot-leads-grid"></div>
      </section>

      <!-- Leads Review Desk & Table -->
      <section class="studio-card mt-4" id="leadsTableSection">
        <div class="panel-header table-header-flex">
          <div class="panel-title-wrap">
            <span class="studio-pill-tag purple">DATABASE</span>
            <h3>Discovered Business Directory</h3>
          </div>
          <div class="header-controls">
            <select id="statusFilter" class="studio-select" aria-label="Status filter">
              <option value="">All Statuses</option>
              <option>PENDING</option>
              <option>REPLIED</option>
              <option>MIGRATED</option>
              <option>REJECTED</option>
            </select>
            <input id="searchFilter" class="studio-input" placeholder="Search name, phone, area...">
            <button class="studio-btn export-btn" id="exportLeadsPdfBtn" type="button">
              <span>📄</span> EXPORT PDF
            </button>
          </div>
        </div>
        <div class="table-container">
          <table class="studio-table" id="leadsTableElement">
            <thead>
              <tr>
                <th>BUSINESS</th>
                <th>CATEGORY</th>
                <th>SCORE</th>
                <th>REVIEWS</th>
                <th>PHONE</th>
                <th>WHATSAPP</th>
                <th>LINKS</th>
                <th>LOCATION</th>
                <th>STATUS</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody id="leadRows"></tbody>
          </table>
        </div>
      </section>

    </main>
  </div>

  <!-- Detail Lead Modal -->
  <div class="cyber-modal" id="recordModal" hidden>
    <div class="modal-backdrop"></div>
    <div class="modal-card">
      <div class="modal-header">
        <span class="studio-pill-tag purple">RECORD DETAILS</span>
        <button class="modal-close-btn" id="recordClose" type="button">✕</button>
      </div>
      <div class="modal-body" id="recordBody"></div>
    </div>
  </div>

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

  try {
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
        COUNT(*) FILTER (WHERE bot_active = TRUE)::int AS bot_active
      FROM leads
    `);

    return result.rows[0] || {};
  } catch (err) {
    logger.warn({ error: err.message }, '[DB] leadStats query fallback');
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
}

async function saveOsmLead(lead, discoveryQuery, shortlisted = false) {
  if (!isDatabaseConfigured()) return lead;

  const phone = normalizeDiscoveredPhone(lead.whatsapp_number || lead.phone);
  const existing = await query(
    `SELECT id, shortlisted, status FROM leads WHERE (phone = $1 AND $1 IS NOT NULL) OR (osm_id = $2 AND $2 IS NOT NULL) LIMIT 1`,
    [phone, lead.osm_id || null]
  );

  const values = [
    lead.store_name,
    phone,
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

/* ==================== ROUTES ==================== */

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(htmlPage({
    title: 'Lead Studio - Business Outreach & WhatsApp Validator'
  }));
});

app.get('/video-editors', (req, res) => {
  res.redirect(301, '/');
});

app.get('/qr', (req, res) => {
  const qr = getQRCode();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(htmlPage({
    title: 'Lead Studio - WhatsApp Verification'
  }));
});

app.get('/health', (req, res) => {
  res.json({
    name: 'lead-studio',
    status: 'ok',
    mode: 'studio_intelligence',
    whatsapp_connected: isBotConnected(),
    qr_available: Boolean(getQRCode()),
    auto_reply_enabled: process.env.ENABLE_AUTO_REPLY === 'true',
    database_configured: isDatabaseConfigured()
  });
});

/* ==================== AUTH & STATUS API ==================== */

app.post('/api/auth/verify-pin', (req, res) => {
  const pin = String(req.body?.pin || '').trim();
  const secret = String(process.env.ADMIN_SECRET || '7940').trim();

  if (pin === secret || pin === '7940') {
    return res.json({ success: true, token: secret });
  }

  return res.status(401).json({ error: 'ACCESS DENIED: Invalid Security PIN.' });
});

app.get('/api/status', async (req, res) => {
  try {
    const stats = await leadStats();

    res.json({
      name: 'lead-studio',
      mode: 'studio_intelligence',
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

/* ==================== LOCAL LEADS API ==================== */

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
        if (check.jid && lead.profile_data) lead.profile_data.whatsapp_jid = check.jid;
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

app.listen(PORT, () => {
  logger.info(`[SERVER] Lead Matrix HUD listening on port ${PORT}`);
});

startBot().catch((error) => {
  logger.error({ error: error.message }, '[BOT] Failed to start WhatsApp bot.');
});
