const state = {
  status: '',
  search: '',
  selectedLat: null,
  selectedLon: null,
  radiusKm: 5,
  map: null,
  marker: null,
  circle: null
};

const $ = (selector) => document.querySelector(selector);

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
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

function updateMapSelection(lat, lon, zoom = 14) {
  state.selectedLat = Number(lat);
  state.selectedLon = Number(lon);
  $('#latitudeInput').value = state.selectedLat.toFixed(7);
  $('#longitudeInput').value = state.selectedLon.toFixed(7);
  $('#mapMeta').textContent = `Selected ${state.selectedLat.toFixed(5)}, ${state.selectedLon.toFixed(5)} with ${state.radiusKm}km radius.`;

  const latLng = [state.selectedLat, state.selectedLon];
  if (!state.marker) {
    state.marker = L.marker(latLng).addTo(state.map);
  } else {
    state.marker.setLatLng(latLng);
  }

  if (!state.circle) {
    state.circle = L.circle(latLng, {
      radius: state.radiusKm * 1000,
      color: '#0f7a55',
      fillColor: '#0f7a55',
      fillOpacity: 0.13,
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
    updateMapSelection(event.latlng.lat, event.latlng.lng);
  });

  updateMapSelection(31.5204, 74.3587, 12);
}

function renderStats(stats = {}) {
  const items = [
    ['Total', stats.total],
    ['Shortlisted', stats.shortlisted],
    ['Discovered', stats.discovered],
    ['With Phone', stats.with_phone],
    ['With Website', stats.with_website],
    ['Pending', stats.pending],
    ['Migrated', stats.migrated],
    ['Rejected', stats.rejected]
  ];

  $('#statsGrid').innerHTML = items.map(([label, value]) => `
    <div class="stat-card">
      <small>${label}</small>
      <strong>${Number(value || 0).toLocaleString()}</strong>
    </div>
  `).join('');
}

function socialMarkup(links = {}) {
  const entries = Object.entries(links || {}).filter(([, value]) => value);
  if (!entries.length) return '<span class="muted">No social found</span>';

  return entries.map(([name, url]) => `
    <a class="link-chip" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(name)}</a>
  `).join('');
}

function googleMapsUrlForLead(lead) {
  const query = [lead.store_name, lead.address, lead.area, 'Pakistan']
    .filter(Boolean)
    .join(', ');

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function webMarkup(lead) {
  const links = [];

  if (lead.website) {
    links.push(`<a class="link-chip" href="${escapeHtml(lead.website)}" target="_blank" rel="noreferrer">Website</a>`);
  }
  if (lead.google_maps_url) {
    links.push(`<a class="link-chip" href="${escapeHtml(googleMapsUrlForLead(lead))}" target="_blank" rel="noreferrer">Google Maps</a>`);
  }
  if (lead.osm_url) {
    links.push(`<a class="link-chip" href="${escapeHtml(lead.osm_url)}" target="_blank" rel="noreferrer">OSM</a>`);
  }

  links.push(socialMarkup(lead.social_links));
  return links.join('');
}

function qualityLabel(score) {
  const value = Number(score || 0);
  if (value >= 75) return 'Strong';
  if (value >= 55) return 'Medium';
  return 'Weak';
}

function qualityBadge(score) {
  const label = qualityLabel(score);
  return `<span class="quality-badge ${label.toLowerCase()}">${label}</span>`;
}

function whatsappMarkup(lead) {
  if (!lead.whatsapp_url && !lead.whatsapp_number) return '<span class="muted">Not available</span>';
  const url = lead.whatsapp_url || `https://wa.me/${lead.whatsapp_number}`;
  const status = lead.whatsapp_available === true
    ? 'Verified'
    : lead.whatsapp_available === false
      ? 'Not on WhatsApp'
      : 'Candidate';

  return `
    <div class="link-stack">
      <a class="button whatsapp-button" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Message</a>
      <span class="pill ${lead.whatsapp_available === true ? 'hot' : ''}">${status}</span>
    </div>
  `;
}

function renderLeads(leads = []) {
  const rows = $('#leadRows');
  if (!rows) return;

  if (!leads.length) {
    rows.innerHTML = '<tr><td colspan="10">No business profiles found.</td></tr>';
    return;
  }

  rows.innerHTML = leads.map((lead) => `
    <tr>
      <td>
        <button class="record-button" data-record='${escapeHtml(JSON.stringify(lead))}'>${escapeHtml(lead.store_name)}</button>
        ${lead.shortlisted ? '<span class="pill hot">Shortlisted</span>' : ''}
        ${qualityBadge(lead.lead_score)}
      </td>
      <td>${escapeHtml(lead.category || '-')}</td>
      <td><span class="score">${Number(lead.lead_score || 0)}</span></td>
      <td>${lead.rating ? `${escapeHtml(lead.rating)} / 5` : 'OSM'}<br><span class="muted">${Number(lead.review_count || 0).toLocaleString()} reviews</span></td>
      <td>${lead.phone && !String(lead.phone).startsWith('osm:') && !String(lead.phone).startsWith('place:') ? escapeHtml(lead.phone) : '<span class="muted">OSM phone only</span>'}</td>
      <td>${whatsappMarkup(lead)}</td>
      <td><div class="link-stack">${webMarkup(lead)}</div></td>
      <td>${escapeHtml(lead.address || lead.area || '-')}<br><span class="muted">${lead.distance_km ? `${lead.distance_km}km away` : ''}</span></td>
      <td><span class="pill ${lead.status === 'REJECTED' ? 'off' : ''}">${escapeHtml(lead.status)}</span></td>
      <td>
        <div class="row-actions">
          <button class="mini-button" data-shortlisted="true" data-lead-id="${lead.id}">Shortlist</button>
          <button class="mini-button" data-shortlisted="false" data-lead-id="${lead.id}">Remove</button>
          <button class="mini-button" data-lead-action="MIGRATED" data-lead-id="${lead.id}">Migrated</button>
          <button class="mini-button" data-lead-action="REJECTED" data-lead-id="${lead.id}">Rejected</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function renderShortlist(leads = []) {
  const list = $('#hotLeads');
  if (!list) return;

  if (!leads.length) {
    list.innerHTML = '<p>No shortlisted records yet.</p>';
    return;
  }

  list.innerHTML = leads.slice(0, 10).map((lead) => `
    <article class="hot-card">
      <h3>${escapeHtml(lead.store_name)}</h3>
      <span class="pill hot">Score ${Number(lead.lead_score || 0)}</span>
      ${qualityBadge(lead.lead_score)}
      <p>${escapeHtml(lead.category || 'Business')} ${lead.distance_km ? `- ${lead.distance_km}km away` : ''}</p>
      <p>${lead.whatsapp_number ? `<strong>${escapeHtml(lead.whatsapp_number)}</strong>` : 'WhatsApp candidate not found'}</p>
      <div class="link-stack">
        ${lead.whatsapp_url ? `<a class="button whatsapp-button" href="${escapeHtml(lead.whatsapp_url)}" target="_blank" rel="noreferrer">Message on WhatsApp</a>` : ''}
        ${webMarkup(lead)}
      </div>
    </article>
  `).join('');
}

function showRecord(lead) {
  const modal = $('#recordModal');
  const body = $('#recordBody');
  if (!modal || !body) return;

  body.innerHTML = `
    <h2>${escapeHtml(lead.store_name)}</h2>
    <p>${qualityBadge(lead.lead_score)}</p>
    <p><strong>Category:</strong> ${escapeHtml(lead.category || '-')}</p>
    <p><strong>Phone:</strong> ${escapeHtml(lead.phone || '-')}</p>
    <p><strong>WhatsApp:</strong> ${escapeHtml(lead.whatsapp_number || '-')}</p>
    <p><strong>Status:</strong> ${escapeHtml(lead.whatsapp_check_method || 'candidate')}</p>
    <p><strong>Address:</strong> ${escapeHtml(lead.address || '-')}</p>
    <p><strong>Distance:</strong> ${lead.distance_km ? `${lead.distance_km}km` : '-'}</p>
    <div class="link-stack">${lead.whatsapp_url ? `<a class="button whatsapp-button" href="${escapeHtml(lead.whatsapp_url)}" target="_blank" rel="noreferrer">Message on WhatsApp</a>` : ''}${webMarkup(lead)}</div>
    <pre>${escapeHtml(JSON.stringify(lead, null, 2))}</pre>
  `;
  modal.hidden = false;
}

async function refreshDashboard() {
  const query = `/api/leads?limit=75&status=${encodeURIComponent(state.status)}&search=${encodeURIComponent(state.search)}`;
  const [status, leads, shortlist] = await Promise.all([
    api('/api/status'),
    api(query),
    api('/api/leads/shortlisted')
  ]);

  $('#waStatus').classList.toggle('connected', status.whatsapp_connected);
  $('#waText').textContent = status.whatsapp_connected ? 'Verifier Ready' : 'Candidate Mode';
  $('#autoReplyText').textContent = status.auto_reply_enabled ? 'On' : 'Off';
  $('#shortlistCount').textContent = Number(status.stats?.shortlisted || 0).toLocaleString();

  renderStats(status.stats);
  renderLeads(leads.leads);
  renderShortlist(shortlist.leads);
}

function bindForms() {
  $('#leadForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const lead = Object.fromEntries(formData.entries());

    try {
      const result = await api('/api/leads/batch', {
        method: 'POST',
        body: JSON.stringify({ leads: [lead] })
      });
      showNotice('#leadResult', `Inserted ${result.inserted_count}, skipped ${result.skipped_count}.`);
      event.currentTarget.reset();
      await refreshDashboard();
    } catch (error) {
      showNotice('#leadResult', error.message, true);
    }
  });

  $('#discoveryForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = Object.fromEntries(formData.entries());
    payload.verify_whatsapp = event.currentTarget.elements.verify_whatsapp.checked;

    try {
      showNotice('#discoveryResult', 'Searching OSM/Overpass and checking WhatsApp candidates.');
      const result = await api('/api/discovery/osm', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      showNotice('#discoveryResult', `Saved ${result.saved_count} records. ${result.whatsapp_verified_count} verified on WhatsApp, ${result.whatsapp_candidate_count} candidates found.`);
      await refreshDashboard();
    } catch (error) {
      showNotice('#discoveryResult', error.message, true);
    }
  });

  $('#radiusInput')?.addEventListener('input', (event) => {
    state.radiusKm = Number(event.currentTarget.value);
    $('#radiusValue').textContent = state.radiusKm;
    if (state.circle) state.circle.setRadius(state.radiusKm * 1000);
    if (state.selectedLat && state.selectedLon) {
      $('#mapMeta').textContent = `Selected ${state.selectedLat.toFixed(5)}, ${state.selectedLon.toFixed(5)} with ${state.radiusKm}km radius.`;
    }
  });

  $('#searchPlaceButton')?.addEventListener('click', async () => {
    const value = $('#placeSearch')?.value?.trim();
    if (!value) return;

    try {
      const result = await api(`/api/osm/geocode?q=${encodeURIComponent(value)}`);
      updateMapSelection(result.latitude, result.longitude, 14);
      $('#mapMeta').textContent = result.display_name;
    } catch (error) {
      showNotice('#discoveryResult', error.message, true);
    }
  });

  $('#statusFilter')?.addEventListener('change', async (event) => {
    state.status = event.currentTarget.value;
    await refreshDashboard();
  });

  $('#searchFilter')?.addEventListener('input', (event) => {
    state.search = event.currentTarget.value;
    clearTimeout(window.searchTimer);
    window.searchTimer = setTimeout(refreshDashboard, 250);
  });

  document.querySelectorAll('[data-action="refresh"]').forEach((button) => {
    button.addEventListener('click', refreshDashboard);
  });

  $('#leadRows')?.addEventListener('click', async (event) => {
    const recordButton = event.target.closest('.record-button');
    if (recordButton) {
      showRecord(JSON.parse(recordButton.dataset.record));
      return;
    }

    const button = event.target.closest('button[data-lead-id]');
    if (!button) return;

    const secret = $('#opsSecret')?.value;
    if (!secret) {
      showNotice('#discoveryResult', 'Admin secret is required for lead actions.', true);
      return;
    }

    const payload = { secret };
    if (button.dataset.leadAction) payload.status = button.dataset.leadAction;
    if (button.dataset.shortlisted !== undefined) payload.shortlisted = button.dataset.shortlisted;

    try {
      await api(`/api/leads/${button.dataset.leadId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      await refreshDashboard();
    } catch (error) {
      showNotice('#discoveryResult', error.message, true);
    }
  });

  $('#recordClose')?.addEventListener('click', () => {
    $('#recordModal').hidden = true;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  if (!$('#statsGrid')) return;

  initMap();
  bindForms();
  refreshDashboard().catch((error) => {
    showNotice('#discoveryResult', error.message, true);
  });
  setInterval(() => refreshDashboard().catch(() => {}), 20000);
});
