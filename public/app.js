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

const videoEditorState = {
  locations: [],
  platforms: [],
  results: [],
  platformFilter: '',
  searchFilter: '',
  hasSearched: false,
  loading: false
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

function formatFollowers(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'Hidden';
  if (number >= 1000000) return `${(number / 1000000).toFixed(number >= 10000000 ? 0 : 1)}M`;
  if (number >= 1000) return `${(number / 1000).toFixed(number >= 10000 ? 0 : 1)}K`;
  return number.toLocaleString();
}

function platformIcon(platform) {
  const icons = {
    instagram: 'IG',
    facebook: 'f',
    tiktok: 'TK'
  };
  return icons[platform] || platform.slice(0, 2).toUpperCase();
}

function followerStatusText(status) {
  if (status === 'verified') return 'Verified range';
  if (status === 'below_range') return 'Below range';
  if (status === 'above_range') return 'Above range';
  return 'Followers hidden';
}

function populateVideoEditorCities(countryCode) {
  const citySelect = $('#veCity');
  if (!citySelect) return;

  const selectedCountry = videoEditorState.locations.find((country) => country.code === countryCode)
    || videoEditorState.locations[0];

  citySelect.innerHTML = (selectedCountry?.cities || []).map((city) => {
    return `<option value="${escapeHtml(city)}">${escapeHtml(city)}</option>`;
  }).join('');
}

function renderVideoEditorPlatforms() {
  const container = $('#vePlatforms');
  if (!container) return;

  container.innerHTML = videoEditorState.platforms.map((platform) => `
    <label class="platform-toggle ${platform.id}">
      <input type="checkbox" name="platforms" value="${escapeHtml(platform.id)}" checked>
      <span class="social-icon ${escapeHtml(platform.id)}">${platformIcon(platform.id)}</span>
      <span>${escapeHtml(platform.label)}</span>
    </label>
  `).join('');
}

function renderVideoEditorResults() {
  const container = $('#videoEditorResults');
  if (!container) return;

  const search = videoEditorState.searchFilter.trim().toLowerCase();
  const platform = videoEditorState.platformFilter;
  const results = videoEditorState.results.filter((account) => {
    const matchesPlatform = !platform || account.platform === platform;
    const haystack = `${account.display_name} ${account.handle} ${account.snippet || ''} ${(account.matched_keywords || []).join(' ')}`.toLowerCase();
    const matchesSearch = !search || haystack.includes(search);
    return matchesPlatform && matchesSearch;
  });

  if (videoEditorState.loading) {
    container.innerHTML = `
      <div class="empty-state">
        <strong>Searching profiles</strong>
        <span>Checking public search results and visible follower metadata.</span>
      </div>
    `;
    return;
  }

  if (!results.length) {
    container.innerHTML = `
      <div class="empty-state">
        <strong>${videoEditorState.hasSearched ? 'No profiles matched' : 'Ready to search'}</strong>
        <span>${videoEditorState.hasSearched ? 'Try another city, platform, or keyword.' : 'Choose a city and platform, then run the search.'}</span>
      </div>
    `;
    return;
  }

  container.innerHTML = results.map((account) => {
    const statusClass = account.follower_status === 'verified' ? 'hot' : 'off';
    const keywords = (account.matched_keywords || []).slice(0, 3).map((keyword) => {
      return `<span class="keyword-chip">${escapeHtml(keyword)}</span>`;
    }).join('');

    return `
      <article class="video-account-card">
        <div class="account-card-top">
          <a class="social-icon ${escapeHtml(account.platform)}" href="${escapeHtml(account.profile_url)}" target="_blank" rel="noreferrer" title="Open ${escapeHtml(account.platform_label)} profile">${platformIcon(account.platform)}</a>
          <div>
            <h3>${escapeHtml(account.display_name || account.handle)}</h3>
            <p>@${escapeHtml(account.handle)} · ${escapeHtml(account.platform_label)}</p>
          </div>
        </div>
        <div class="account-facts">
          <span><small>Followers</small><strong>${formatFollowers(account.followers)}</strong></span>
          <span><small>Match</small><strong>${Number(account.score || 0)}</strong></span>
        </div>
        <p class="account-bio">${escapeHtml(account.bio || account.snippet || 'Public profile candidate')}</p>
        <div class="keyword-row">${keywords}</div>
        <div class="account-actions">
          <span class="pill ${statusClass}">${followerStatusText(account.follower_status)}</span>
          <a class="button social-open ${escapeHtml(account.platform)}" href="${escapeHtml(account.profile_url)}" target="_blank" rel="noreferrer">
            <span class="social-icon ${escapeHtml(account.platform)}">${platformIcon(account.platform)}</span>
            Open
          </a>
        </div>
      </article>
    `;
  }).join('');
}

async function initVideoEditorPage() {
  const config = await api('/api/video-editors/locations');
  videoEditorState.locations = config.countries || [];
  videoEditorState.platforms = config.platforms || [];

  const countrySelect = $('#veCountry');
  if (countrySelect) {
    countrySelect.innerHTML = videoEditorState.locations.map((country) => {
      return `<option value="${escapeHtml(country.code)}">${escapeHtml(country.name)}</option>`;
    }).join('');
    populateVideoEditorCities(countrySelect.value);
  }

  const keywordsInput = $('#videoEditorForm textarea[name="keywords"]');
  if (keywordsInput && config.default_keywords?.length) {
    keywordsInput.value = config.default_keywords.slice(0, 10).join(', ');
  }

  renderVideoEditorPlatforms();
  renderVideoEditorResults();

  countrySelect?.addEventListener('change', (event) => {
    populateVideoEditorCities(event.currentTarget.value);
  });

  $('#vePlatformFilter')?.addEventListener('change', (event) => {
    videoEditorState.platformFilter = event.currentTarget.value;
    renderVideoEditorResults();
  });

  $('#veResultFilter')?.addEventListener('input', (event) => {
    videoEditorState.searchFilter = event.currentTarget.value;
    renderVideoEditorResults();
  });

  $('#videoEditorForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    payload.platforms = formData.getAll('platforms');
    payload.include_unverified = form.elements.include_unverified.checked;

    try {
      videoEditorState.loading = true;
      videoEditorState.hasSearched = true;
      renderVideoEditorResults();
      showNotice('#videoEditorNotice', 'Searching public social profiles and checking visible follower counts.');
      const result = await api('/api/video-editors/search', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      videoEditorState.loading = false;
      videoEditorState.results = result.accounts || [];
      $('#veReturnedCount').textContent = Number(result.returned_count || 0).toLocaleString();
      $('#veVerifiedCount').textContent = Number(result.verified_count || 0).toLocaleString();
      $('#veDiscoveredCount').textContent = Number(result.discovered_count || 0).toLocaleString();
      showNotice(
        '#videoEditorNotice',
        `Listed ${result.returned_count || 0} accounts from ${result.discovered_count || 0} public profiles. ${result.verified_count || 0} have visible followers inside the selected range.`
      );
      renderVideoEditorResults();
    } catch (error) {
      videoEditorState.loading = false;
      renderVideoEditorResults();
      showNotice('#videoEditorNotice', error.message, true);
    }
  });
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
      <td data-label="Business">
        <button class="record-button" data-record='${escapeHtml(JSON.stringify(lead))}'>${escapeHtml(lead.store_name)}</button>
        ${lead.shortlisted ? '<span class="pill hot">Shortlisted</span>' : ''}
        ${qualityBadge(lead.lead_score)}
      </td>
      <td data-label="Category">${escapeHtml(lead.category || '-')}</td>
      <td data-label="Score"><span class="score">${Number(lead.lead_score || 0)}</span></td>
      <td data-label="Reviews">${lead.rating ? `${escapeHtml(lead.rating)} / 5` : 'OSM'}<br><span class="muted">${Number(lead.review_count || 0).toLocaleString()} reviews</span></td>
      <td data-label="Phone">${lead.phone && !String(lead.phone).startsWith('osm:') && !String(lead.phone).startsWith('place:') ? escapeHtml(lead.phone) : '<span class="muted">OSM phone only</span>'}</td>
      <td data-label="WhatsApp">${whatsappMarkup(lead)}</td>
      <td data-label="Links"><div class="link-stack">${webMarkup(lead)}</div></td>
      <td data-label="Address">${escapeHtml(lead.address || lead.area || '-')}<br><span class="muted">${lead.distance_km ? `${lead.distance_km}km away` : ''}</span></td>
      <td data-label="Status"><span class="pill ${lead.status === 'REJECTED' ? 'off' : ''}">${escapeHtml(lead.status)}</span></td>
      <td data-label="Actions">
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
  if ($('#videoEditorPage')) {
    initVideoEditorPage().catch((error) => {
      showNotice('#videoEditorNotice', error.message, true);
    });
    return;
  }

  if (!$('#statsGrid')) return;

  initMap();
  bindForms();
  refreshDashboard().catch((error) => {
    showNotice('#discoveryResult', error.message, true);
  });
  setInterval(() => refreshDashboard().catch(() => {}), 20000);
});
