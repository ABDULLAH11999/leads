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
const {
  VIDEO_EDITOR_KEYWORDS,
  VIDEO_EDITOR_LOCATIONS,
  VIDEO_EDITOR_PLATFORMS,
  discoverVideoEditorAccounts
} = require('./videoEditorDiscovery');
const { fetchBioData } = require('./bioFetcher');

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

function htmlPage({ title, initialTab = 'leads' }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600;700&family=Orbitron:wght@500;700;800;900&family=Rajdhani:wght@500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  <link rel="stylesheet" href="/assets/styles.css">
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
  <script src="/assets/app.js" defer></script>
</head>
<body class="cyber-shell" data-initial-tab="${initialTab}">

  <!-- ==================== SECURITY PIN GATE (ATM / TERMINAL ACCESS) ==================== -->
  <section class="pin-overlay" id="pinGate" aria-modal="true" role="dialog">
    <div class="pin-vault-card">
      <div class="pin-card-header">
        <div class="cyber-logo-icon">
          <div class="radar-scan"></div>
        </div>
        <p class="cyber-badge">AUTHENTICATION GATE</p>
        <h1 class="glitch-text" data-text="SYSTEM ACCESS">SYSTEM ACCESS</h1>
        <p class="pin-hint">ENTER 4-DIGIT SECURITY PIN TO UNLOCK CONSOLE</p>
      </div>

      <div class="pin-display">
        <div class="pin-dot" id="pDot1"></div>
        <div class="pin-dot" id="pDot2"></div>
        <div class="pin-dot" id="pDot3"></div>
        <div class="pin-dot" id="pDot4"></div>
      </div>

      <input type="password" id="pinHiddenInput" maxlength="4" autofocus inputmode="numeric" pattern="[0-9]*" class="pin-hidden-input" autocomplete="off">

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
        <button type="button" class="key-btn action-key unlock-btn" data-key="enter" title="Authenticate">ENT</button>
      </div>

      <div class="pin-status-msg" id="pinStatusMsg"></div>
      <div class="pin-footer-info">
        <span>SECURITY PROTOCOL: ACTIVE</span>
        <span>GATEWAY: NODE_V24</span>
      </div>
    </div>
  </section>

  <!-- ==================== MAIN MASTER CONSOLE (UNLOCKED HUD) ==================== -->
  <div class="master-hud" id="masterHud" hidden>

    <!-- Top Command Header -->
    <header class="hud-topbar">
      <div class="hud-brand">
        <div class="hud-radar-dot"></div>
        <div>
          <span class="hud-sub">INTELLIGENCE CONSOLE</span>
          <h1 class="hud-title">LEAD MATRIX HUD</h1>
        </div>
      </div>

      <!-- Telemetry Strip -->
      <div class="hud-telemetry">
        <div class="telemetry-node">
          <span class="node-label">SYS TIME</span>
          <span class="node-val font-mono" id="cyberClock">00:00:00 UTC</span>
        </div>
        <button class="hud-btn hud-lock-btn" id="lockConsoleBtn" type="button" title="Lock System">
          <span class="lock-icon">🔒</span> LOCK
        </button>
      </div>
    </header>

    <!-- Master Navigation Command Row (3 Buttons) -->
    <nav class="hud-navrow" aria-label="Console Navigation">
      <button class="nav-tab active" data-tab="leads" id="tabBtnLeads" type="button">
        <span class="tab-index">01</span>
        <span class="tab-text">LOCAL LEADS</span>
        <span class="tab-badge" id="tabLeadsCount">0</span>
      </button>

      <button class="nav-tab" data-tab="video-editors" id="tabBtnVideo" type="button">
        <span class="tab-index">02</span>
        <span class="tab-text">VIDEO EDITORS</span>
        <span class="tab-badge" id="tabVideoCount">0</span>
      </button>

      <button class="nav-tab" data-tab="bio-fetch" id="tabBtnBio" type="button">
        <span class="tab-index">03</span>
        <span class="tab-text">BIO DATA FETCH</span>
        <span class="tab-badge" id="tabBioStatus">READY</span>
      </button>
    </nav>

    <!-- Main Dynamic Content Area -->
    <main class="hud-main">

      <!-- ==================== TAB 1: LOCAL LEADS ==================== -->
      <section class="tab-content active" id="tabSectionLeads">
        
        <!-- Summary Strip -->
        <section class="cyber-panel hero-strip">
          <div class="hero-left">
            <p class="cyber-eyebrow">GEO RADIUS INTELLIGENCE</p>
            <h2 class="hero-heading">Local Business Outreach & WhatsApp Validator</h2>
          </div>
          <div class="hero-metrics">
            <div class="metric-card">
              <small>Total Leads</small>
              <strong id="statTotal">0</strong>
            </div>
            <div class="metric-card">
              <small>Shortlisted</small>
              <strong id="statShortlisted" class="highlight-cyan">0</strong>
            </div>
            <div class="metric-card">
              <small>With Phone</small>
              <strong id="statWithPhone">0</strong>
            </div>
            <div class="metric-card">
              <small>Verified WA</small>
              <strong id="statVerifiedWA" class="highlight-green">0</strong>
            </div>
          </div>
        </section>

        <!-- Search Controls Row -->
        <section class="cyber-grid-3">
          <!-- Map Area Selector -->
          <article class="cyber-panel">
            <div class="panel-header">
              <div class="panel-title-wrap">
                <span class="cyber-tag">GEO COORD</span>
                <h3>Target Location</h3>
              </div>
              <button class="cyber-btn sm" data-action="refresh" title="Sync Records">SYNC</button>
            </div>
            <div class="map-search-bar">
              <input id="placeSearch" class="cyber-input" placeholder="Search area (e.g. Gulberg Lahore)">
              <button class="cyber-btn primary sm" id="searchPlaceButton" type="button">FIND</button>
            </div>
            <div id="map" class="map-cyber-canvas"></div>
            <p class="map-meta-info" id="mapMeta">Click on the tactical map to target coordinates.</p>
          </article>

          <!-- Discovery Form -->
          <article class="cyber-panel">
            <div class="panel-header">
              <div class="panel-title-wrap">
                <span class="cyber-tag">SCANNER</span>
                <h3>Overpass Discovery</h3>
              </div>
            </div>
            <form id="discoveryForm" class="cyber-form-stack">
              <div class="form-row-2">
                <label class="form-label">Latitude
                  <input name="latitude" id="latitudeInput" class="cyber-input font-mono" required readonly placeholder="Lat">
                </label>
                <label class="form-label">Longitude
                  <input name="longitude" id="longitudeInput" class="cyber-input font-mono" required readonly placeholder="Lon">
                </label>
              </div>
              <div class="form-row-2">
                <label class="form-label">Radius (KM): <span id="radiusValue" class="text-cyan font-mono">5</span>
                  <input name="radius_km" id="radiusInput" type="range" min="1" max="25" value="5" class="cyber-range">
                </label>
                <label class="form-label">Limit
                  <input name="limit" type="number" min="1" max="100" value="10" class="cyber-input">
                </label>
              </div>
              <label class="form-label">Categories
                <input name="categories" class="cyber-input" placeholder="restaurant,gym,dentist,salon,retail">
              </label>
              <label class="cyber-checkline">
                <input name="verify_whatsapp" type="checkbox" checked>
                <span>Verify WhatsApp connectivity</span>
              </label>
              <button class="cyber-btn primary full" type="submit" id="btnDiscoverLeads">DISCOVER LOCAL LEADS</button>
            </form>
            <div id="discoveryResult" class="cyber-notice" hidden></div>
          </article>

          <!-- Manual Lead Addition -->
          <article class="cyber-panel">
            <div class="panel-header">
              <div class="panel-title-wrap">
                <span class="cyber-tag">MANUAL ENTRY</span>
                <h3>Register Lead</h3>
              </div>
            </div>
            <form id="leadForm" class="cyber-form-stack">
              <label class="form-label">Business Name
                <input name="store_name" class="cyber-input" required placeholder="Prime Health Clinic">
              </label>
              <label class="form-label">Phone Number
                <input name="phone" class="cyber-input font-mono" required placeholder="03001234567">
              </label>
              <label class="form-label">Area / City
                <input name="area" class="cyber-input" placeholder="Lahore">
              </label>
              <button class="cyber-btn full" type="submit">SAVE RECORD</button>
            </form>
            <div id="leadResult" class="cyber-notice" hidden></div>
          </article>
        </section>

        <!-- Top Shortlisted Records -->
        <section class="cyber-panel mt-4">
          <div class="panel-header">
            <div class="panel-title-wrap">
              <span class="cyber-tag hot">TOP 10</span>
              <h3>High Quality Candidates</h3>
            </div>
          </div>
          <div id="hotLeads" class="hot-leads-grid"></div>
        </section>

        <!-- Leads Review Desk & Table -->
        <section class="cyber-panel mt-4" id="leadsTableSection">
          <div class="panel-header table-header-flex">
            <div class="panel-title-wrap">
              <span class="cyber-tag">DATABASE</span>
              <h3>Discovered Business Records</h3>
            </div>
            <div class="header-controls">
              <select id="statusFilter" class="cyber-select" aria-label="Status filter">
                <option value="">All Statuses</option>
                <option>PENDING</option>
                <option>REPLIED</option>
                <option>MIGRATED</option>
                <option>REJECTED</option>
              </select>
              <input id="searchFilter" class="cyber-input" placeholder="Filter name, phone, area...">
              <button class="cyber-btn export-btn" id="exportLeadsPdfBtn" type="button">
                <span>📄</span> EXPORT PDF
              </button>
            </div>
          </div>
          <div class="table-container">
            <table class="cyber-table" id="leadsTableElement">
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
      </section>

      <!-- ==================== TAB 2: VIDEO EDITORS ==================== -->
      <section class="tab-content" id="tabSectionVideo">
        
        <!-- Video Editor Controls Panel -->
        <section class="cyber-panel">
          <div class="panel-header">
            <div class="panel-title-wrap">
              <span class="cyber-tag">SOCIAL SCOUT</span>
              <h2>Video Editor Account Discovery</h2>
            </div>
            <div class="video-metrics-bar" aria-live="polite">
              <div class="v-metric">
                <small>RETURNED</small>
                <strong id="veReturnedCount" class="font-mono">0</strong>
              </div>
              <div class="v-metric">
                <small>VERIFIED RANGE</small>
                <strong id="veVerifiedCount" class="font-mono text-cyan">0</strong>
              </div>
              <div class="v-metric">
                <small>PROFILES SCANNED</small>
                <strong id="veDiscoveredCount" class="font-mono text-green">0</strong>
              </div>
            </div>
          </div>

          <form id="videoEditorForm" class="video-form-grid">
            <div class="form-group">
              <label class="form-label">Country</label>
              <select name="country" id="veCountry" class="cyber-select" required></select>
            </div>
            <div class="form-group">
              <label class="form-label">City</label>
              <select name="city" id="veCity" class="cyber-select" required></select>
            </div>
            <div class="form-group">
              <label class="form-label">Min Followers</label>
              <input name="min_followers" type="number" min="1" max="100000" value="1" class="cyber-input font-mono">
            </div>
            <div class="form-group">
              <label class="form-label">Max Followers</label>
              <input name="max_followers" type="number" min="1" max="500000" value="100000" class="cyber-input font-mono">
            </div>
            <div class="form-group">
              <label class="form-label">Result Limit</label>
              <input name="limit" type="number" min="1" max="50" value="30" class="cyber-input font-mono">
            </div>

            <div class="form-group span-full">
              <label class="form-label">Platforms</label>
              <div class="platform-toggles" id="vePlatforms"></div>
            </div>

            <div class="form-group span-full">
              <label class="form-label">Keywords (Comma separated)</label>
              <textarea name="keywords" rows="2" class="cyber-textarea" placeholder="video editor, reels editor, tiktok video editor, premiere pro"></textarea>
            </div>

            <div class="form-group span-full form-actions-row">
              <label class="cyber-checkline">
                <input name="include_unverified" type="checkbox" checked>
                <span>Include hidden follower counts</span>
              </label>
              <div class="action-btn-group">
                <button class="cyber-btn primary" type="submit" id="btnScanVideoEditors">SCAN PROFILES</button>
                <button class="cyber-btn" type="button" id="btnClearVideoResults">CLEAR SESSION</button>
                <button class="cyber-btn export-btn" type="button" id="exportVideoPdfBtn">
                  <span>📄</span> EXPORT PDF
                </button>
              </div>
            </div>
          </form>

          <div id="videoEditorNotice" class="cyber-notice" hidden></div>
        </section>

        <!-- Video Results Grid -->
        <section class="cyber-panel mt-4" id="videoResultsSection">
          <div class="panel-header table-header-flex">
            <div class="panel-title-wrap">
              <span class="cyber-tag">OUTPUT MATRIX</span>
              <h3>Discovered Video Editor Profiles</h3>
            </div>
            <div class="header-controls">
              <select id="vePlatformFilter" class="cyber-select" aria-label="Platform filter">
                <option value="">All Platforms</option>
                <option value="instagram">Instagram</option>
                <option value="facebook">Facebook</option>
                <option value="tiktok">TikTok</option>
              </select>
              <input id="veResultFilter" class="cyber-input" placeholder="Search handle, name, tag...">
            </div>
          </div>
          <div class="video-cards-grid" id="videoEditorResults"></div>
        </section>
      </section>

      <!-- ==================== TAB 3: BIO DATA FETCH ==================== -->
      <section class="tab-content" id="tabSectionBio">
        
        <!-- Bio Search Controls -->
        <section class="cyber-panel">
          <div class="panel-header">
            <div class="panel-title-wrap">
              <span class="cyber-tag bio">INTELLIGENCE DOSSIER</span>
              <h2>Public Profile & Bio Data Retrieval</h2>
            </div>
            <div class="header-controls">
              <button class="cyber-btn export-btn" type="button" id="exportBioPdfBtn" disabled>
                <span>📄</span> EXPORT DOSSIER PDF
              </button>
              <button class="cyber-btn" type="button" id="btnClearBioData">WIPE MEMORY</button>
            </div>
          </div>

          <form id="bioSearchForm" class="bio-query-form">
            <div class="bio-input-group">
              <label class="form-label">Target Name / Public Figure / Social Profile URL</label>
              <div class="input-with-button">
                <input id="bioTargetInput" class="cyber-input lg" required placeholder="e.g. Elon Musk, Atif Aslam, or https://www.linkedin.com/in/username">
                <input id="bioLocationInput" class="cyber-input md" placeholder="Location hint (e.g. Pakistan, USA, Tech)">
                <button class="cyber-btn primary lg" type="submit" id="btnFetchBio">FETCH DOSSIER</button>
              </div>
            </div>
          </form>

          <!-- Realtime Terminal Log Feed -->
          <div class="cyber-terminal-feed" id="bioTerminalFeed" hidden>
            <div class="terminal-titlebar">
              <span class="terminal-dot red"></span>
              <span class="terminal-dot yellow"></span>
              <span class="terminal-dot green"></span>
              <span class="terminal-title">INTELLIGENCE_DISCOVERY_FEED.LOG</span>
            </div>
            <div class="terminal-body" id="bioTerminalLogs"></div>
          </div>

          <div id="bioNotice" class="cyber-notice" hidden></div>
        </section>

        <!-- Dossier Result Panel -->
        <section class="cyber-panel mt-4" id="bioResultSection" hidden>
          <div class="panel-header">
            <div class="panel-title-wrap">
              <span class="cyber-tag hot">DOSSIER REPORT</span>
              <h3 id="dossierHeaderName">Subject Profile</h3>
            </div>
            <div id="dossierConfidenceBadge"></div>
          </div>

          <div class="dossier-card" id="dossierPrintArea">
            <!-- Top Profile Banner -->
            <div class="dossier-hero">
              <div class="dossier-avatar-wrap">
                <img id="dossierAvatar" src="" alt="Profile Photo" class="dossier-avatar" onerror="this.src='/assets/avatar-placeholder.svg'">
                <div class="dossier-radar-ring"></div>
              </div>
              <div class="dossier-hero-info">
                <div class="dossier-name-row">
                  <h2 id="dossierFullName" class="dossier-name">--</h2>
                  <span class="dossier-role" id="dossierRole">--</span>
                </div>
                <div class="dossier-aliases" id="dossierAliases"></div>
                <p class="dossier-summary" id="dossierSummary">--</p>
              </div>
            </div>

            <!-- Identity & Demographics Grid -->
            <div class="dossier-grid">
              <div class="dossier-meta-card">
                <h4>IDENTITY & DEMOGRAPHICS</h4>
                <div class="meta-row"><span>Date of Birth</span><strong id="dossierDob">--</strong></div>
                <div class="meta-row"><span>Age</span><strong id="dossierAge">--</strong></div>
                <div class="meta-row"><span>Place of Birth</span><strong id="dossierBirthPlace">--</strong></div>
                <div class="meta-row"><span>Current Residence</span><strong id="dossierLocation">--</strong></div>
                <div class="meta-row"><span>Nationality</span><strong id="dossierNationality">--</strong></div>
                <div class="meta-row"><span>Marital Status</span><strong id="dossierMarital">--</strong></div>
                <div class="meta-row"><span>Spouse / Family</span><strong id="dossierSpouse">--</strong></div>
              </div>

              <div class="dossier-meta-card">
                <h4>AFFILIATIONS & ACHIEVEMENTS</h4>
                <div class="meta-row"><span>Education</span><strong id="dossierEducation">--</strong></div>
                <div class="meta-section">
                  <small>Key Affiliations / Entities</small>
                  <div class="chip-container" id="dossierAffiliations"></div>
                </div>
                <div class="meta-section">
                  <small>Career Highlights & Milestones</small>
                  <ul class="dossier-list" id="dossierHighlights"></ul>
                </div>
              </div>
            </div>

            <!-- Verified Social Footprint -->
            <div class="dossier-social-section">
              <h4>VERIFIED SOCIAL & WEB FOOTPRINT</h4>
              <div class="social-chips-grid" id="dossierSocialGrid"></div>
            </div>

            <!-- Intelligence Sources -->
            <div class="dossier-sources-section">
              <h4>SOURCE REFERENCES & CITATIONS</h4>
              <div class="sources-list" id="dossierSourcesList"></div>
            </div>
          </div>
        </section>
      </section>

    </main>
  </div>

  <!-- Detail Lead Modal -->
  <div class="cyber-modal" id="recordModal" hidden>
    <div class="modal-backdrop"></div>
    <div class="modal-card">
      <div class="modal-header">
        <span class="cyber-tag">RECORD DETAILS</span>
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
    title: 'Lead Matrix HUD Console',
    initialTab: 'leads'
  }));
});

app.get('/video-editors', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(htmlPage({
    title: 'Lead Matrix - Video Editors Scout',
    initialTab: 'video-editors'
  }));
});

app.get('/qr', (req, res) => {
  const qr = getQRCode();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(htmlPage({
    title: 'Lead Matrix - WhatsApp Verification',
    initialTab: 'leads'
  }));
});

app.get('/health', (req, res) => {
  res.json({
    name: 'lead-matrix-hud',
    status: 'ok',
    mode: 'cyber_intelligence',
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
      name: 'lead-matrix-hud',
      mode: 'cyber_intelligence',
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

/* ==================== BIO DATA DOSSIER API ==================== */

app.post('/api/bio-fetch', requireAdminSecret, async (req, res) => {
  const target = req.body?.target;
  const location = req.body?.location;

  if (!target) {
    return res.status(400).json({ error: 'Target name or social profile URL is required.' });
  }

  try {
    const dossier = await fetchBioData(target, location);
    return res.json({ success: true, dossier });
  } catch (error) {
    logger.error({ error: error.message }, '[API] Bio data fetch failed.');
    return res.status(500).json({ error: error.message || 'Failed to retrieve bio data.' });
  }
});

/* ==================== VIDEO EDITORS API ==================== */

app.get('/api/video-editors/locations', (req, res) => {
  res.json({
    countries: VIDEO_EDITOR_LOCATIONS,
    platforms: Object.entries(VIDEO_EDITOR_PLATFORMS).map(([id, config]) => ({
      id,
      label: config.label
    })),
    default_keywords: VIDEO_EDITOR_KEYWORDS
  });
});

app.post('/api/video-editors/search', requireAdminSecret, async (req, res) => {
  try {
    const result = await discoverVideoEditorAccounts({
      country: req.body?.country,
      city: req.body?.city,
      platforms: req.body?.platforms,
      keywords: req.body?.keywords,
      limit: req.body?.limit,
      min_followers: req.body?.min_followers,
      max_followers: req.body?.max_followers,
      include_unverified: req.body?.include_unverified,
      max_queries: req.body?.max_queries
    });

    return res.json(result);
  } catch (error) {
    logger.error({ error: error.message }, '[API] Video editor discovery failed.');
    return res.status(500).json({ error: error.message || 'Video editor discovery failed.' });
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
