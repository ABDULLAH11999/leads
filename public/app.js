/**
 * CYBER AUDIO ENGINE - Web Audio API Synthesizer
 * Zero external audio dependencies - 100% native procedural sound generation.
 */
class CyberAudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = localStorage.getItem('hud_muted') === 'true';
    this.analyzingInterval = null;
  }

  initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  isReady() {
    return !this.muted && this.ctx;
  }

  toggleMute() {
    this.muted = !this.muted;
    localStorage.setItem('hud_muted', String(this.muted));
    this.stopAnalyzing();
    return this.muted;
  }

  // Keypad click: ATM / DTMF cyber tone
  playKeypad(digit) {
    this.initContext();
    if (!this.isReady()) return;

    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      const freqMap = {
        '1': 697, '2': 770, '3': 852,
        '4': 697, '5': 770, '6': 852,
        '7': 941, '8': 941, '9': 1209,
        '0': 1336, 'clear': 440, 'enter': 1477
      };

      const baseFreq = freqMap[digit] || 880;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.4, now + 0.04);

      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.08);
    } catch (_) {}
  }

  // Access Granted: Ascending 3-chord cyber fanfare
  playAccessGranted() {
    this.initContext();
    if (!this.isReady()) return;

    try {
      const now = this.ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6

      notes.forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.08);

        gain.gain.setValueAtTime(0, now + idx * 0.08);
        gain.gain.linearRampToValueAtTime(0.15, now + idx * 0.08 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.28);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now + idx * 0.08);
        osc.stop(now + idx * 0.08 + 0.3);
      });
    } catch (_) {}
  }

  // Access Denied: Low glitch buzz & alarm
  playAccessDenied() {
    this.initContext();
    if (!this.isReady()) return;

    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.linearRampToValueAtTime(90, now + 0.22);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.26);
    } catch (_) {}
  }

  // Tab Switch: Sci-fi interface frequency slide
  playTabSwitch() {
    this.initContext();
    if (!this.isReady()) return;

    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);

      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.1);
    } catch (_) {}
  }

  // Scan initiate / Radar trigger
  playScanTrigger() {
    this.initContext();
    if (!this.isReady()) return;

    try {
      const now = this.ctx.currentTime;
      // Sub sweep
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(180, now);
      osc1.frequency.exponentialRampToValueAtTime(60, now + 0.35);
      gain1.gain.setValueAtTime(0.18, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc1.connect(gain1);
      gain1.connect(this.ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.36);

      // Radar ping high
      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1760, now);
      osc2.frequency.exponentialRampToValueAtTime(1400, now + 0.25);
      gain2.gain.setValueAtTime(0.1, now);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      osc2.connect(gain2);
      gain2.connect(this.ctx.destination);
      osc2.start(now);
      osc2.stop(now + 0.26);
    } catch (_) {}
  }

  // Analyzing loop sound generator
  startAnalyzing() {
    this.initContext();
    this.stopAnalyzing();
    if (!this.isReady()) return;

    const playBeep = () => {
      if (!this.isReady()) return;
      try {
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        const freqs = [1046.5, 1318.5, 1567.98, 2093.0];
        const f = freqs[Math.floor(Math.random() * freqs.length)];

        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, now);

        gain.gain.setValueAtTime(0.03, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.06);
      } catch (_) {}
    };

    this.analyzingInterval = setInterval(playBeep, 240);
  }

  stopAnalyzing() {
    if (this.analyzingInterval) {
      clearInterval(this.analyzingInterval);
      this.analyzingInterval = null;
    }
  }

  // Data Loaded / Dossier Ready: Harmonic completion chime
  playDataSuccess() {
    this.stopAnalyzing();
    this.initContext();
    if (!this.isReady()) return;

    try {
      const now = this.ctx.currentTime;
      const freqs = [587.33, 880.00, 1174.66, 1760.00]; // D chord high

      freqs.forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.05);

        gain.gain.setValueAtTime(0.12, now + idx * 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.05 + 0.4);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now + idx * 0.05);
        osc.stop(now + idx * 0.05 + 0.45);
      });
    } catch (_) {}
  }

  // Shortlist / Tactical button blip
  playTacticalBlip() {
    this.initContext();
    if (!this.isReady()) return;

    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, now);
      osc.frequency.exponentialRampToValueAtTime(1600, now + 0.04);

      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.06);
    } catch (_) {}
  }

  // PDF Export laser / render tone
  playPdfExport() {
    this.initContext();
    if (!this.isReady()) return;

    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.linearRampToValueAtTime(2400, now + 0.18);

      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.24);
    } catch (_) {}
  }
}

const audio = new CyberAudioEngine();

/* ==========================================================================
   APP STATE & HELPERS
   ========================================================================== */

const state = {
  authToken: sessionStorage.getItem('hud_auth') || '',
  activeTab: 'leads',
  leads: [],
  shortlisted: [],
  status: '',
  search: '',
  selectedLat: 31.5204,
  selectedLon: 74.3587,
  radiusKm: 5,
  map: null,
  marker: null,
  circle: null
};

const videoEditorState = {
  locations: [],
  platforms: [],
  results: [],
  platformFilter: '',
  searchFilter: '',
  hasSearched: false,
  loading: false
};

const bioState = {
  currentDossier: null,
  loading: false
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (state.authToken) {
    headers['secret'] = state.authToken;
    headers['x-admin-secret'] = state.authToken;
  }

  const response = await fetch(path, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed with ${response.status}`);
  }
  return data;
}

function showNotice(id, message, isError = false) {
  const element = $(id);
  if (!element) return;
  element.hidden = false;
  element.classList.toggle('error', isError);
  element.textContent = message;
}

/* ==========================================================================
   AUTHENTICATION PIN GATE CONTROLLER
   ========================================================================== */

let currentPin = '';

function updatePinDisplay() {
  // Mobile dots sync
  for (let i = 1; i <= 4; i++) {
    const dot = $(`#pDot${i}`);
    if (dot) dot.classList.toggle('filled', i <= currentPin.length);
  }

  // Desktop 4 boxes sync
  for (let i = 0; i < 4; i++) {
    const box = $(`#pinBox${i + 1}`);
    if (box) {
      box.value = currentPin[i] || '';
    }
  }
}

async function verifyAndUnlockPin(pinToVerify) {
  const statusEl = $('#pinStatusMsg');
  statusEl.className = 'pin-status-msg';
  statusEl.textContent = 'AUTHENTICATING SECURE PIN...';

  try {
    const result = await fetch('/api/auth/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: pinToVerify })
    });

    const data = await result.json();

    if (result.ok && data.success) {
      state.authToken = data.token || pinToVerify;
      sessionStorage.setItem('hud_auth', state.authToken);

      audio.playAccessGranted();
      statusEl.className = 'pin-status-msg success';
      statusEl.textContent = 'ACCESS GRANTED. DECRYPTING HUD...';

      setTimeout(() => {
        $('#pinGate').classList.add('unlocked');
        $('#masterHud').hidden = false;
        refreshDashboard().catch(() => {});
      }, 400);
    } else {
      throw new Error(data.error || 'INVALID PIN');
    }
  } catch (err) {
    audio.playAccessDenied();
    statusEl.className = 'pin-status-msg error';
    statusEl.textContent = err.message || 'ACCESS DENIED: INCORRECT PIN';
    currentPin = '';
    updatePinDisplay();
    $('#pinBox1')?.focus();
  }
}

function handlePinKey(key) {
  audio.playKeypad(key);

  if (key === 'clear') {
    currentPin = '';
    updatePinDisplay();
    $('#pinBox1')?.focus();
    return;
  }

  if (key === 'enter') {
    if (currentPin.length === 4) {
      verifyAndUnlockPin(currentPin);
    }
    return;
  }

  if (/^[0-9]$/.test(key) && currentPin.length < 4) {
    currentPin += key;
    updatePinDisplay();
    const nextIdx = currentPin.length;
    if (nextIdx < 4) {
      $(`#pinBox${nextIdx + 1}`)?.focus();
    } else if (currentPin.length === 4) {
      setTimeout(() => verifyAndUnlockPin(currentPin), 150);
    }
  }
}

function initPinGate() {
  const pinGate = $('#pinGate');
  const masterHud = $('#masterHud');

  if (state.authToken === '7940' || state.authToken) {
    pinGate.classList.add('unlocked');
    masterHud.hidden = false;
  }

  // Desktop 4 boxes events
  const pinBoxes = [$('#pinBox1'), $('#pinBox2'), $('#pinBox3'), $('#pinBox4')];

  pinBoxes.forEach((box, idx) => {
    if (!box) return;

    box.addEventListener('input', (e) => {
      const val = e.target.value.replace(/[^0-9]/g, '');
      if (val) {
        audio.playKeypad(val.slice(-1));
        const pinArr = currentPin.split('');
        pinArr[idx] = val.slice(-1);
        currentPin = pinArr.join('').slice(0, 4);
        updatePinDisplay();

        if (idx < 3) {
          pinBoxes[idx + 1]?.focus();
        }

        if (currentPin.length === 4) {
          setTimeout(() => verifyAndUnlockPin(currentPin), 150);
        }
      }
    });

    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace') {
        audio.playKeypad('clear');
        if (!box.value && idx > 0) {
          pinBoxes[idx - 1].value = '';
          const pinArr = currentPin.split('');
          pinArr[idx - 1] = '';
          currentPin = pinArr.join('');
          updatePinDisplay();
          pinBoxes[idx - 1]?.focus();
        } else {
          box.value = '';
          const pinArr = currentPin.split('');
          pinArr[idx] = '';
          currentPin = pinArr.join('');
          updatePinDisplay();
        }
      } else if (e.key === 'ArrowLeft' && idx > 0) {
        pinBoxes[idx - 1]?.focus();
      } else if (e.key === 'ArrowRight' && idx < 3) {
        pinBoxes[idx + 1]?.focus();
      } else if (e.key === 'Enter') {
        if (currentPin.length === 4) {
          verifyAndUnlockPin(currentPin);
        }
      }
    });

    box.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/[^0-9]/g, '').slice(0, 4);
      if (pasted) {
        audio.playKeypad('9');
        currentPin = pasted;
        updatePinDisplay();
        if (currentPin.length === 4) {
          setTimeout(() => verifyAndUnlockPin(currentPin), 150);
        }
      }
    });
  });

  // Mobile Keypad clicks
  $('#keypadGrid')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.key-btn');
    if (btn) handlePinKey(btn.dataset.key);
  });

  $('#lockConsoleBtn')?.addEventListener('click', () => {
    audio.playTacticalBlip();
    sessionStorage.removeItem('hud_auth');
    state.authToken = '';
    currentPin = '';
    updatePinDisplay();
    $('#pinStatusMsg').textContent = '';
    pinGate.classList.remove('unlocked');
    masterHud.hidden = true;
    setTimeout(() => $('#pinBox1')?.focus(), 200);
  });
}

/* ==========================================================================
   NAVIGATION TAB SWITCHER
   ========================================================================== */

function switchTab(tabName) {
  state.activeTab = tabName;
  $$('.nav-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tabName));
  $$('.tab-content').forEach((sec) => sec.classList.toggle('active', sec.id === `tabSection${capitalize(tabName)}`));

  if (tabName === 'leads' && state.map) {
    setTimeout(() => state.map.invalidateSize(), 150);
  }
}

function capitalize(str) {
  if (str === 'leads') return 'Leads';
  if (str === 'video-editors') return 'Video';
  if (str === 'bio-fetch') return 'Bio';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function initNavTabs() {
  $$('.nav-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      audio.playTabSwitch();
      switchTab(btn.dataset.tab);
    });
  });

  const initialTab = document.body.dataset.initialTab || 'leads';
  switchTab(initialTab);
}

/* ==========================================================================
   SOUND & TELEMETRY CONTROLS
   ========================================================================== */

function initSoundToggle() {
  const btn = $('#soundToggleBtn');
  if (!btn) return;

  const updateLabel = () => {
    btn.innerHTML = audio.muted
      ? '<span class="icon">🔇</span> <span class="txt">AUDIO OFF</span>'
      : '<span class="icon">🔊</span> <span class="txt">AUDIO ON</span>';
    btn.classList.toggle('muted', audio.muted);
  };

  updateLabel();

  btn.addEventListener('click', () => {
    const isMuted = audio.toggleMute();
    updateLabel();
    if (!isMuted) audio.playTacticalBlip();
  });
}

function startCyberClock() {
  const clockEl = $('#cyberClock');
  if (!clockEl) return;

  const update = () => {
    const now = new Date();
    clockEl.textContent = now.toISOString().slice(11, 19) + ' UTC';
  };
  update();
  setInterval(update, 1000);
}

/* ==========================================================================
   TAB 1: LOCAL LEADS (MAP & DISCOVERY)
   ========================================================================== */

function updateMapSelection(lat, lon, zoom = 14) {
  state.selectedLat = Number(lat);
  state.selectedLon = Number(lon);
  if ($('#latitudeInput')) $('#latitudeInput').value = state.selectedLat.toFixed(7);
  if ($('#longitudeInput')) $('#longitudeInput').value = state.selectedLon.toFixed(7);
  if ($('#mapMeta')) {
    $('#mapMeta').textContent = `Target: ${state.selectedLat.toFixed(5)}, ${state.selectedLon.toFixed(5)} (${state.radiusKm}km radius)`;
  }

  const latLng = [state.selectedLat, state.selectedLon];
  if (!state.marker) {
    state.marker = L.marker(latLng).addTo(state.map);
  } else {
    state.marker.setLatLng(latLng);
  }

  if (!state.circle) {
    state.circle = L.circle(latLng, {
      radius: state.radiusKm * 1000,
      color: '#00ff9d',
      fillColor: '#00f0ff',
      fillOpacity: 0.12,
      weight: 2
    }).addTo(state.map);
  } else {
    state.circle.setLatLng(latLng);
    state.circle.setRadius(state.radiusKm * 1000);
  }

  state.map.setView(latLng, zoom);
}

function initMap() {
  if (!$('#map') || !window.L) return;

  state.map = L.map('map', {
    zoomControl: true,
    scrollWheelZoom: true
  }).setView([31.5204, 74.3587], 12);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(state.map);

  state.map.on('click', (event) => {
    audio.playTacticalBlip();
    updateMapSelection(event.latlng.lat, event.latlng.lng);
  });

  updateMapSelection(31.5204, 74.3587, 12);
}

function qualityLabel(score) {
  const value = Number(score || 0);
  if (value >= 75) return 'Strong';
  if (value >= 55) return 'Medium';
  return 'Weak';
}

function qualityBadge(score) {
  const label = qualityLabel(score);
  return `<span class="quality-pill ${label.toLowerCase()}">${label}</span>`;
}

function whatsappMarkup(lead) {
  if (!lead.whatsapp_url && !lead.whatsapp_number) return '<span class="text-dim">None</span>';
  const url = lead.whatsapp_url || `https://wa.me/${lead.whatsapp_number}`;
  const isVer = lead.whatsapp_available === true;
  return `
    <div style="display:flex; flex-direction:column; gap:4px;">
      <a class="wa-btn" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">WA Chat</a>
      <small style="color:${isVer ? 'var(--green)' : 'var(--amber)'}">${isVer ? '● Verified' : '○ Candidate'}</small>
    </div>
  `;
}

function webMarkup(lead) {
  const links = [];
  if (lead.website) links.push(`<a class="link-chip" href="${escapeHtml(lead.website)}" target="_blank" rel="noreferrer">Web</a>`);
  if (lead.google_maps_url) links.push(`<a class="link-chip" href="${escapeHtml(lead.google_maps_url)}" target="_blank" rel="noreferrer">Map</a>`);
  if (lead.osm_url) links.push(`<a class="link-chip" href="${escapeHtml(lead.osm_url)}" target="_blank" rel="noreferrer">OSM</a>`);
  return links.length ? links.join('') : '<span class="text-dim">No links</span>';
}

function renderLeads(leads = []) {
  const rows = $('#leadRows');
  if (!rows) return;

  $('#tabLeadsCount').textContent = leads.length;

  if (!leads.length) {
    rows.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:28px;" class="text-dim">No business profiles discovered yet. Run scanner above.</td></tr>';
    return;
  }

  rows.innerHTML = leads.map((lead) => `
    <tr>
      <td>
        <button class="record-btn" data-record='${escapeHtml(JSON.stringify(lead))}'>${escapeHtml(lead.store_name)}</button>
        ${lead.shortlisted ? '<span class="cyber-tag hot" style="margin-left:6px;">HOT</span>' : ''}
        ${qualityBadge(lead.lead_score)}
      </td>
      <td>${escapeHtml(lead.category || '-')}</td>
      <td><span class="score-badge">${Number(lead.lead_score || 0)}</span></td>
      <td>${lead.rating ? `${escapeHtml(lead.rating)} ★` : 'OSM'}<br><small class="text-dim">${Number(lead.review_count || 0)} rev</small></td>
      <td class="font-mono">${lead.phone && !lead.phone.startsWith('osm:') ? escapeHtml(lead.phone) : '<span class="text-dim">N/A</span>'}</td>
      <td>${whatsappMarkup(lead)}</td>
      <td>${webMarkup(lead)}</td>
      <td>${escapeHtml(lead.address || lead.area || '-')}<br><small class="text-dim">${lead.distance_km ? `${lead.distance_km}km` : ''}</small></td>
      <td><span class="cyber-tag ${lead.status === 'REJECTED' ? 'error' : ''}">${escapeHtml(lead.status)}</span></td>
      <td>
        <div style="display:flex; gap:4px; flex-wrap:wrap;">
          <button class="cyber-btn sm" data-shortlisted="true" data-lead-id="${lead.id}">★ Shortlist</button>
          <button class="cyber-btn sm" data-lead-action="REJECTED" data-lead-id="${lead.id}">✕ Reject</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function renderShortlist(leads = []) {
  const list = $('#hotLeads');
  if (!list) return;

  if (!leads.length) {
    list.innerHTML = '<p class="text-dim">No shortlisted leads yet. Click Shortlist on candidates.</p>';
    return;
  }

  list.innerHTML = leads.slice(0, 8).map((lead) => `
    <article class="hot-card">
      <div style="display:flex; justify-content:space-between; align-items:start;">
        <h4>${escapeHtml(lead.store_name)}</h4>
        <span class="score-badge">${Number(lead.lead_score || 0)}</span>
      </div>
      <p style="font-size:0.82rem;" class="text-dim">${escapeHtml(lead.category || 'Business')} · ${lead.area || 'Local'}</p>
      <div style="display:flex; gap:6px; align-items:center;">
        ${lead.whatsapp_url ? `<a class="wa-btn" href="${escapeHtml(lead.whatsapp_url)}" target="_blank" rel="noreferrer">WA Message</a>` : ''}
        ${webMarkup(lead)}
      </div>
    </article>
  `).join('');
}

function showRecordModal(lead) {
  const modal = $('#recordModal');
  const body = $('#recordBody');
  if (!modal || !body) return;

  audio.playTacticalBlip();
  body.innerHTML = `
    <h2 class="dossier-name" style="font-size:1.4rem; margin-bottom:12px;">${escapeHtml(lead.store_name)}</h2>
    <div style="display:flex; gap:8px; margin-bottom:14px;">
      <span class="score-badge">Score: ${Number(lead.lead_score || 0)}</span>
      ${qualityBadge(lead.lead_score)}
      <span class="cyber-tag">${escapeHtml(lead.status || 'PENDING')}</span>
    </div>
    <div class="meta-row"><span>Category</span><strong>${escapeHtml(lead.category || '-')}</strong></div>
    <div class="meta-row"><span>Phone</span><strong class="font-mono">${escapeHtml(lead.phone || '-')}</strong></div>
    <div class="meta-row"><span>WhatsApp</span><strong class="font-mono">${escapeHtml(lead.whatsapp_number || '-')}</strong></div>
    <div class="meta-row"><span>Address</span><strong>${escapeHtml(lead.address || lead.area || '-')}</strong></div>
    <div class="meta-row"><span>Distance</span><strong>${lead.distance_km ? `${lead.distance_km} km` : '-'}</strong></div>
    <div style="margin-top:16px; display:flex; gap:10px;">
      ${lead.whatsapp_url ? `<a class="cyber-btn primary sm" href="${escapeHtml(lead.whatsapp_url)}" target="_blank">Open WhatsApp</a>` : ''}
      ${lead.website ? `<a class="cyber-btn sm" href="${escapeHtml(lead.website)}" target="_blank">Website</a>` : ''}
    </div>
  `;
  modal.hidden = false;
}

async function refreshDashboard() {
  const query = `/api/leads?limit=75&status=${encodeURIComponent(state.status)}&search=${encodeURIComponent(state.search)}`;
  const [statusData, leadsData, shortlistData] = await Promise.all([
    api('/api/status'),
    api(query),
    api('/api/leads/shortlisted')
  ]);

  $('#waStatus').classList.toggle('connected', statusData.whatsapp_connected);
  $('#waText').textContent = statusData.whatsapp_connected ? 'Connected' : 'Candidate Mode';

  const stats = statusData.stats || {};
  $('#statTotal').textContent = Number(stats.total || 0).toLocaleString();
  $('#statShortlisted').textContent = Number(stats.shortlisted || 0).toLocaleString();
  $('#statWithPhone').textContent = Number(stats.with_phone || 0).toLocaleString();
  $('#statVerifiedWA').textContent = Number(stats.discovered || 0).toLocaleString();

  state.leads = leadsData.leads || [];
  state.shortlisted = shortlistData.leads || [];

  renderLeads(state.leads);
  renderShortlist(state.shortlisted);
}

function bindLeadsControls() {
  $('#radiusInput')?.addEventListener('input', (e) => {
    state.radiusKm = Number(e.target.value);
    $('#radiusValue').textContent = state.radiusKm;
    if (state.circle) state.circle.setRadius(state.radiusKm * 1000);
    if (state.selectedLat && state.selectedLon && $('#mapMeta')) {
      $('#mapMeta').textContent = `Target: ${state.selectedLat.toFixed(5)}, ${state.selectedLon.toFixed(5)} (${state.radiusKm}km radius)`;
    }
  });

  $('#searchPlaceButton')?.addEventListener('click', async () => {
    const value = $('#placeSearch')?.value?.trim();
    if (!value) return;
    audio.playScanTrigger();
    try {
      const result = await api(`/api/osm/geocode?q=${encodeURIComponent(value)}`);
      updateMapSelection(result.latitude, result.longitude, 14);
      audio.playTacticalBlip();
    } catch (err) {
      audio.playAccessDenied();
      showNotice('#discoveryResult', err.message, true);
    }
  });

  $('#discoveryForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const payload = Object.fromEntries(formData.entries());
    payload.verify_whatsapp = e.currentTarget.elements.verify_whatsapp.checked;

    audio.playScanTrigger();
    audio.startAnalyzing();

    try {
      showNotice('#discoveryResult', 'Executing Overpass scanner query...');
      const result = await api('/api/discovery/osm', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      audio.playDataSuccess();
      showNotice('#discoveryResult', `Success: Captured ${result.saved_count} records. Verified WA: ${result.whatsapp_verified_count}.`);
      await refreshDashboard();
      $('#leadsTableSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      audio.stopAnalyzing();
      audio.playAccessDenied();
      showNotice('#discoveryResult', err.message, true);
    }
  });

  $('#leadForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const lead = Object.fromEntries(formData.entries());

    audio.playTacticalBlip();
    try {
      const result = await api('/api/leads/batch', {
        method: 'POST',
        body: JSON.stringify({ leads: [lead] })
      });
      audio.playDataSuccess();
      showNotice('#leadResult', `Saved: Added ${result.inserted_count} business.`);
      e.currentTarget.reset();
      await refreshDashboard();
    } catch (err) {
      audio.playAccessDenied();
      showNotice('#leadResult', err.message, true);
    }
  });

  $('#leadRows')?.addEventListener('click', async (e) => {
    const recBtn = e.target.closest('.record-btn');
    if (recBtn) {
      showRecordModal(JSON.parse(recBtn.dataset.record));
      return;
    }

    const btn = e.target.closest('button[data-lead-id]');
    if (!btn) return;

    audio.playTacticalBlip();
    const payload = {};
    if (btn.dataset.leadAction) payload.status = btn.dataset.leadAction;
    if (btn.dataset.shortlisted !== undefined) payload.shortlisted = btn.dataset.shortlisted;

    try {
      await api(`/api/leads/${btn.dataset.leadId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      await refreshDashboard();
    } catch (err) {
      audio.playAccessDenied();
      alert(err.message);
    }
  });

  $('#statusFilter')?.addEventListener('change', async (e) => {
    audio.playTacticalBlip();
    state.status = e.target.value;
    await refreshDashboard();
  });

  $('#searchFilter')?.addEventListener('input', (e) => {
    state.search = e.target.value;
    clearTimeout(window.searchTimer);
    window.searchTimer = setTimeout(refreshDashboard, 250);
  });

  $('#recordClose')?.addEventListener('click', () => {
    audio.playTacticalBlip();
    $('#recordModal').hidden = true;
  });

  // PDF Export for Leads Table
  $('#exportLeadsPdfBtn')?.addEventListener('click', () => {
    const tableEl = $('#leadsTableSection');
    if (!tableEl) return;
    audio.playPdfExport();
    if (window.html2pdf) {
      const opt = {
        margin: 10,
        filename: `Leads_Report_${Date.now()}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
      };
      window.html2pdf().set(opt).from(tableEl).save();
    } else {
      window.print();
    }
  });
}

/* ==========================================================================
   TAB 2: VIDEO EDITORS CONTROLLER
   ========================================================================== */

function formatFollowers(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'Hidden';
  if (number >= 1000000) return `${(number / 1000000).toFixed(1)}M`;
  if (number >= 1000) return `${(number / 1000).toFixed(1)}K`;
  return number.toLocaleString();
}

function platformBadge(platform) {
  const p = platform.toLowerCase();
  if (p === 'instagram') return '<span class="social-badge-icon instagram">IG</span>';
  if (p === 'facebook') return '<span class="social-badge-icon facebook">FB</span>';
  if (p === 'tiktok') return '<span class="social-badge-icon tiktok">TK</span>';
  return `<span class="social-badge-icon">${p.slice(0, 2).toUpperCase()}</span>`;
}

function populateVideoEditorCities(countryCode) {
  const citySelect = $('#veCity');
  if (!citySelect) return;
  const selectedCountry = videoEditorState.locations.find((c) => c.code === countryCode) || videoEditorState.locations[0];
  citySelect.innerHTML = (selectedCountry?.cities || []).map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
}

function renderVideoEditorPlatforms() {
  const container = $('#vePlatforms');
  if (!container) return;
  container.innerHTML = videoEditorState.platforms.map((p) => `
    <label class="platform-toggle">
      <input type="checkbox" name="platforms" value="${escapeHtml(p.id)}" checked>
      ${platformBadge(p.id)}
      <span>${escapeHtml(p.label)}</span>
    </label>
  `).join('');
}

function renderVideoEditorResults() {
  const container = $('#videoEditorResults');
  if (!container) return;

  const search = videoEditorState.searchFilter.trim().toLowerCase();
  const platform = videoEditorState.platformFilter;
  const results = videoEditorState.results.filter((acc) => {
    const matchPlat = !platform || acc.platform === platform;
    const haystack = `${acc.display_name} ${acc.handle} ${acc.snippet || ''}`.toLowerCase();
    const matchSearch = !search || haystack.includes(search);
    return matchPlat && matchSearch;
  });

  $('#tabVideoCount').textContent = results.length;

  if (videoEditorState.loading) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align:center; padding:40px;" class="cyber-notice">
        <span class="pulse">SCANNING SOCIAL INDICES & ANALYZING FOLLOWER METRICS...</span>
      </div>
    `;
    return;
  }

  if (!results.length) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align:center; padding:32px;" class="text-dim">
        ${videoEditorState.hasSearched ? 'No profile accounts matched filters.' : 'Select location parameters and click "Scan Profiles" to discover editors.'}
      </div>
    `;
    return;
  }

  container.innerHTML = results.map((acc) => {
    const isVer = acc.follower_status === 'verified';
    const kwBadges = (acc.matched_keywords || []).slice(0, 3).map((k) => `<span class="kw-chip">${escapeHtml(k)}</span>`).join('');

    return `
      <article class="video-account-card">
        <div class="account-card-top">
          ${platformBadge(acc.platform)}
          <div>
            <h3>${escapeHtml(acc.display_name || acc.handle)}</h3>
            <p>@${escapeHtml(acc.handle)} · ${escapeHtml(acc.platform_label)}</p>
          </div>
        </div>
        <div class="account-facts">
          <span><small>Followers</small><strong>${formatFollowers(acc.followers)}</strong></span>
          <span><small>Match Score</small><strong>${Number(acc.score || 0)}</strong></span>
        </div>
        <p class="account-bio">${escapeHtml(acc.bio || acc.snippet || 'Public video editing creator candidate.')}</p>
        <div class="keyword-chips-row">${kwBadges}</div>
        <div class="account-actions-row">
          <span class="cyber-tag ${isVer ? 'hot' : ''}">${isVer ? 'Verified Range' : 'Public Candidate'}</span>
          <a class="cyber-btn primary sm" href="${escapeHtml(acc.profile_url)}" target="_blank" rel="noreferrer">
            Open Profile ↗
          </a>
        </div>
      </article>
    `;
  }).join('');
}

async function initVideoEditorControls() {
  try {
    const config = await api('/api/video-editors/locations');
    videoEditorState.locations = config.countries || [];
    videoEditorState.platforms = config.platforms || [];

    const countrySelect = $('#veCountry');
    if (countrySelect) {
      countrySelect.innerHTML = videoEditorState.locations.map((c) => `<option value="${escapeHtml(c.code)}">${escapeHtml(c.name)}</option>`).join('');
      populateVideoEditorCities(countrySelect.value);
      countrySelect.addEventListener('change', (e) => {
        audio.playTacticalBlip();
        populateVideoEditorCities(e.target.value);
      });
    }

    const kwTextarea = $('#videoEditorForm textarea[name="keywords"]');
    if (kwTextarea && config.default_keywords?.length) {
      kwTextarea.value = config.default_keywords.slice(0, 8).join(', ');
    }

    renderVideoEditorPlatforms();
    renderVideoEditorResults();
  } catch (err) {
    console.warn('Video locations config load error:', err.message);
  }

  $('#vePlatformFilter')?.addEventListener('change', (e) => {
    audio.playTacticalBlip();
    videoEditorState.platformFilter = e.target.value;
    renderVideoEditorResults();
  });

  $('#veResultFilter')?.addEventListener('input', (e) => {
    videoEditorState.searchFilter = e.target.value;
    renderVideoEditorResults();
  });

  $('#videoEditorForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const payload = Object.fromEntries(formData.entries());
    payload.platforms = formData.getAll('platforms');
    payload.include_unverified = e.currentTarget.elements.include_unverified.checked;

    audio.playScanTrigger();
    audio.startAnalyzing();

    try {
      videoEditorState.loading = true;
      videoEditorState.hasSearched = true;
      renderVideoEditorResults();
      showNotice('#videoEditorNotice', 'Scanning public search results & calculating follower ranges...');

      const result = await api('/api/video-editors/search', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      audio.playDataSuccess();
      videoEditorState.loading = false;
      videoEditorState.results = result.accounts || [];

      $('#veReturnedCount').textContent = Number(result.returned_count || 0).toLocaleString();
      $('#veVerifiedCount').textContent = Number(result.verified_count || 0).toLocaleString();
      $('#veDiscoveredCount').textContent = Number(result.discovered_count || 0).toLocaleString();

      showNotice('#videoEditorNotice', `Discovered ${result.returned_count || 0} matching editor accounts.`);
      renderVideoEditorResults();
      $('#videoResultsSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      audio.stopAnalyzing();
      audio.playAccessDenied();
      videoEditorState.loading = false;
      renderVideoEditorResults();
      showNotice('#videoEditorNotice', err.message, true);
    }
  });

  $('#btnClearVideoResults')?.addEventListener('click', () => {
    audio.playTacticalBlip();
    videoEditorState.results = [];
    videoEditorState.hasSearched = false;
    renderVideoEditorResults();
    $('#veReturnedCount').textContent = '0';
    $('#veVerifiedCount').textContent = '0';
    $('#veDiscoveredCount').textContent = '0';
    showNotice('#videoEditorNotice', 'Session results cleared.');
  });

  $('#exportVideoPdfBtn')?.addEventListener('click', () => {
    const el = $('#videoResultsSection');
    if (!el) return;
    audio.playPdfExport();
    if (window.html2pdf) {
      const opt = {
        margin: 10,
        filename: `Video_Editors_Report_${Date.now()}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };
      window.html2pdf().set(opt).from(el).save();
    } else {
      window.print();
    }
  });
}

/* ==========================================================================
   TAB 3: BIO DATA FETCH & INTELLIGENCE DOSSIER
   ========================================================================== */

function appendTerminalLog(text) {
  const container = $('#bioTerminalLogs');
  if (!container) return;
  const line = document.createElement('div');
  line.className = 'log-line';
  line.textContent = `[${new Date().toISOString().slice(11, 19)}] ${text}`;
  container.appendChild(line);
  container.scrollTop = container.scrollHeight;
}

function renderDossier(dossier) {
  const resSec = $('#bioResultSection');
  if (!dossier || !resSec) return;

  $('#dossierHeaderName').textContent = dossier.full_name || 'Subject Profile';
  $('#dossierFullName').textContent = dossier.full_name || '--';
  $('#dossierRole').textContent = dossier.primary_role || 'Public Figure';

  // Avatar
  const avatarEl = $('#dossierAvatar');
  if (avatarEl) {
    avatarEl.src = dossier.avatar_url || '/assets/avatar-placeholder.svg';
  }

  // Aliases
  const aliasEl = $('#dossierAliases');
  if (aliasEl) {
    const list = dossier.aliases || [];
    aliasEl.innerHTML = list.length ? `Aliases: ${list.map(escapeHtml).join(', ')}` : '';
  }

  // Summary
  $('#dossierSummary').textContent = dossier.summary || 'No biographical summary recorded.';

  // Demographics
  $('#dossierDob').textContent = dossier.dob || 'Not documented';
  $('#dossierAge').textContent = dossier.age || 'Unknown';
  $('#dossierBirthPlace').textContent = dossier.birth_place || 'Not confirmed';
  $('#dossierLocation').textContent = dossier.location || 'Global';
  $('#dossierNationality').textContent = dossier.nationality || 'Verified';
  $('#dossierMarital').textContent = dossier.marital_status || 'Not Public';
  $('#dossierSpouse').textContent = dossier.spouse || 'Not listed';
  $('#dossierEducation').textContent = dossier.education || 'Professional Track';

  // Affiliations
  const affEl = $('#dossierAffiliations');
  if (affEl) {
    const items = dossier.affiliations || [];
    affEl.innerHTML = items.length
      ? items.map((a) => `<span class="kw-chip">${escapeHtml(a)}</span>`).join('')
      : '<span class="text-dim">None listed</span>';
  }

  // Highlights
  const hlEl = $('#dossierHighlights');
  if (hlEl) {
    const hls = dossier.career_highlights || [];
    hlEl.innerHTML = hls.length
      ? hls.map((h) => `<li>${escapeHtml(h)}</li>`).join('')
      : '<li>Active public career profile</li>';
  }

  // Confidence badge
  const score = dossier.confidence_score || 85;
  $('#dossierConfidenceBadge').innerHTML = `
    <span class="cyber-tag ${score >= 80 ? 'hot' : ''}">CONFIDENCE: ${score}%</span>
  `;

  // Social Grid
  const socialGrid = $('#dossierSocialGrid');
  if (socialGrid) {
    const links = dossier.social_links || {};
    const platformDefs = [
      { id: 'linkedin', label: 'LinkedIn', icon: 'LI' },
      { id: 'instagram', label: 'Instagram', icon: 'IG' },
      { id: 'facebook', label: 'Facebook', icon: 'FB' },
      { id: 'twitter_x', label: 'X (Twitter)', icon: 'X' },
      { id: 'youtube', label: 'YouTube', icon: 'YT' },
      { id: 'tiktok', label: 'TikTok', icon: 'TK' },
      { id: 'github', label: 'GitHub', icon: 'GH' },
      { id: 'wikipedia', label: 'Wikipedia', icon: 'WK' },
      { id: 'website', label: 'Official Web', icon: 'WEB' }
    ];

    socialGrid.innerHTML = platformDefs.map((p) => {
      const url = links[p.id];
      if (url) {
        return `
          <a class="social-profile-chip" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">
            <span class="social-badge-icon ${p.id}">${p.icon}</span>
            <span>${p.label}</span>
          </a>
        `;
      } else {
        return `
          <div class="social-profile-chip disabled">
            <span class="social-badge-icon">${p.icon}</span>
            <span>${p.label} (Not Found)</span>
          </div>
        `;
      }
    }).join('');
  }

  // Sources
  const sourcesEl = $('#dossierSourcesList');
  if (sourcesEl) {
    const srcs = dossier.sources || [];
    sourcesEl.innerHTML = srcs.length
      ? srcs.map((s) => `
        <div class="source-item">
          ● <a href="${escapeHtml(s.url)}" target="_blank" rel="noreferrer">${escapeHtml(s.title || s.url)}</a>
        </div>
      `).join('')
      : '<span class="text-dim">Public web open intelligence search.</span>';
  }

  resSec.hidden = false;
  $('#exportBioPdfBtn').disabled = false;
  $('#tabBioStatus').textContent = 'LOADED';
}

function initBioFetchControls() {
  $('#bioSearchForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const target = $('#bioTargetInput')?.value?.trim();
    const location = $('#bioLocationInput')?.value?.trim();

    if (!target) return;

    audio.playScanTrigger();
    audio.startAnalyzing();

    const termFeed = $('#bioTerminalFeed');
    const termLogs = $('#bioTerminalLogs');
    termLogs.innerHTML = '';
    termFeed.hidden = false;

    appendTerminalLog(`[+] Initiating deep profile scan for target: "${target}"`);
    appendTerminalLog(`[+] Querying Wikipedia & public intelligence databases...`);

    const logTimer = setInterval(() => {
      const steps = [
        '[+] Querying web indexes and social graph footprints...',
        '[+] Resolving OpenGraph metadata & avatar media...',
        '[+] Synthesizing structured intelligence dossier with AI...'
      ];
      const randomStep = steps[Math.floor(Math.random() * steps.length)];
      appendTerminalLog(randomStep);
    }, 1200);

    try {
      showNotice('#bioNotice', 'Scanning public intelligence indices...');
      const response = await api('/api/bio-fetch', {
        method: 'POST',
        body: JSON.stringify({ target, location })
      });

      clearInterval(logTimer);
      audio.playDataSuccess();
      appendTerminalLog('[+] Intelligence dossier compiled successfully.');
      showNotice('#bioNotice', `Dossier compiled for ${response.dossier?.full_name || target}.`);

      bioState.currentDossier = response.dossier;
      renderDossier(response.dossier);
      $('#bioResultSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      clearInterval(logTimer);
      audio.stopAnalyzing();
      audio.playAccessDenied();
      appendTerminalLog(`[-] SCAN FAILED: ${err.message}`);
      showNotice('#bioNotice', err.message, true);
    }
  });

  $('#btnClearBioData')?.addEventListener('click', () => {
    audio.playTacticalBlip();
    bioState.currentDossier = null;
    $('#bioResultSection').hidden = true;
    $('#bioTerminalFeed').hidden = true;
    $('#exportBioPdfBtn').disabled = true;
    $('#tabBioStatus').textContent = 'READY';
    $('#bioTargetInput').value = '';
    $('#bioLocationInput').value = '';
    showNotice('#bioNotice', 'Session memory wiped clean.');
  });

  $('#exportBioPdfBtn')?.addEventListener('click', () => {
    const el = $('#dossierPrintArea');
    if (!el) return;
    audio.playPdfExport();
    const name = bioState.currentDossier?.full_name || 'Target';
    if (window.html2pdf) {
      const opt = {
        margin: 10,
        filename: `Intelligence_Dossier_${name.replace(/\s+/g, '_')}_${Date.now()}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };
      window.html2pdf().set(opt).from(el).save();
    } else {
      window.print();
    }
  });
}

/* ==========================================================================
   APP INITIALIZATION
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  initSoundToggle();
  initPinGate();
  initNavTabs();
  startCyberClock();
  initMap();
  bindLeadsControls();
  initVideoEditorControls();
  initBioFetchControls();

  if (state.authToken) {
    refreshDashboard().catch(() => {});
  }
});
