require('dotenv').config();

const axios = require('axios');

const OVERPASS_URL = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const NOMINATIM_URL = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org/search';

const BUSINESS_CATEGORY_FILTERS = {
  restaurant: { key: 'amenity', values: ['restaurant', 'fast_food', 'food_court'] },
  cafe: { key: 'amenity', values: ['cafe'] },
  gym: { key: 'leisure', values: ['fitness_centre', 'sports_centre'] },
  dentist: { key: 'amenity', values: ['dentist'] },
  clinic: { key: 'amenity', values: ['clinic', 'doctors', 'hospital'] },
  pharmacy: { key: 'amenity', values: ['pharmacy'] },
  salon: { key: 'shop', values: ['beauty', 'hairdresser'] },
  retail: { key: 'shop', values: ['clothes', 'shoes', 'jewelry', 'electronics', 'furniture', 'mobile_phone', 'supermarket'] },
  hotel: { key: 'tourism', values: ['hotel', 'guest_house'] },
  repair: { key: 'shop', values: ['car_repair', 'computer', 'electronics'] }
};

const DEFAULT_OSM_CATEGORIES = Object.keys(BUSINESS_CATEGORY_FILTERS);

function appUserAgent() {
  const email = process.env.OSM_CONTACT_EMAIL;
  return email ? `lead-engine/1.0 (${email})` : 'lead-engine/1.0';
}

function parseLimit(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function clampRadiusKm(radiusKm) {
  const parsed = Number.parseFloat(radiusKm);
  if (!Number.isFinite(parsed) || parsed <= 0) return 5;
  return Math.min(parsed, 25);
}

function normalizeCategories(categories) {
  if (Array.isArray(categories) && categories.length) {
    return categories.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof categories === 'string' && categories.trim()) {
    return categories.split(',').map((item) => item.trim()).filter(Boolean);
  }

  return DEFAULT_OSM_CATEGORIES;
}

function escapeOverpassRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function categoryRegex(categories) {
  const values = [];

  for (const category of categories) {
    const filter = BUSINESS_CATEGORY_FILTERS[category];
    if (filter) values.push(...filter.values);
  }

  return values.length ? values.map(escapeOverpassRegex).join('|') : '.+';
}

function buildOverpassQuery({ latitude, longitude, radiusKm, categories }) {
  const radiusMeters = Math.round(clampRadiusKm(radiusKm) * 1000);
  const normalized = normalizeCategories(categories);
  const regex = categoryRegex(normalized);
  const categoryClauses = Object.values(BUSINESS_CATEGORY_FILTERS)
    .map((filter) => filter.key)
    .filter((value, index, array) => array.indexOf(value) === index)
    .map((key) => {
      const tagRegex = key === 'amenity' || key === 'shop' || key === 'tourism' || key === 'leisure'
        ? regex
        : '.+';
      return [
        `nwr(around:${radiusMeters},${latitude},${longitude})["name"]["${key}"~"${tagRegex}"]["phone"];`,
        `nwr(around:${radiusMeters},${latitude},${longitude})["name"]["${key}"~"${tagRegex}"]["contact:phone"];`,
        `nwr(around:${radiusMeters},${latitude},${longitude})["name"]["${key}"~"${tagRegex}"]["mobile"];`,
        `nwr(around:${radiusMeters},${latitude},${longitude})["name"]["${key}"~"${tagRegex}"]["contact:mobile"];`,
        `nwr(around:${radiusMeters},${latitude},${longitude})["name"]["${key}"~"${tagRegex}"]["contact:whatsapp"];`
      ].join('\n');
    })
    .join('\n');

  return `[out:json][timeout:35];
(
${categoryClauses}
);
out center tags;`;
}

function haversineKm(aLat, aLon, bLat, bLon) {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(h));
}

function firstTag(tags, keys) {
  for (const key of keys) {
    if (tags?.[key]) return tags[key];
  }
  return null;
}

function normalizeSocialUrl(network, value) {
  if (!value) return null;

  const cleaned = String(value).trim();
  if (!cleaned) return null;
  if (/^https?:\/\//i.test(cleaned)) return cleaned;

  const username = cleaned.replace(/^@/, '').replace(/^\/+/, '');
  if (!username) return null;

  const bases = {
    facebook: 'https://www.facebook.com/',
    instagram: 'https://www.instagram.com/',
    tiktok: 'https://www.tiktok.com/@',
    youtube: 'https://www.youtube.com/',
    linkedin: 'https://www.linkedin.com/in/'
  };

  return bases[network] ? `${bases[network]}${username}` : cleaned;
}

function firstTagWithKey(tags, keys) {
  for (const key of keys) {
    if (tags?.[key]) {
      return {
        key,
        value: tags[key]
      };
    }
  }
  return {
    key: null,
    value: null
  };
}

function socialLinksFromTags(tags) {
  return {
    facebook: normalizeSocialUrl('facebook', firstTag(tags, ['contact:facebook', 'facebook'])),
    instagram: normalizeSocialUrl('instagram', firstTag(tags, ['contact:instagram', 'instagram'])),
    tiktok: normalizeSocialUrl('tiktok', firstTag(tags, ['contact:tiktok', 'tiktok'])),
    youtube: normalizeSocialUrl('youtube', firstTag(tags, ['contact:youtube', 'youtube'])),
    linkedin: normalizeSocialUrl('linkedin', firstTag(tags, ['contact:linkedin', 'linkedin']))
  };
}

function normalizeWhatsappNumber(rawPhone, defaultCountryCode = '92') {
  if (!rawPhone) return null;

  const first = String(rawPhone)
    .split(/[;,/|]/)
    .map((item) => item.trim())
    .find(Boolean);

  if (!first) return null;

  let number = first
    .replace(/(?:ext|extension|x)\.?\s*\d+$/i, '')
    .replace(/[^\d+]/g, '');

  if (number.startsWith('+')) number = number.slice(1);
  if (number.startsWith('00')) number = number.slice(2);
  if (number.startsWith('0') && defaultCountryCode) number = `${defaultCountryCode}${number.slice(1)}`;
  if (defaultCountryCode === '92' && number.startsWith('3') && number.length === 10) number = `92${number}`;

  if (!/^\d{10,15}$/.test(number)) return null;
  return number;
}

function detectCategory(tags = {}) {
  return tags.amenity || tags.shop || tags.leisure || tags.tourism || tags.healthcare || tags.office || tags.craft || 'business';
}

function scoreOsmBusiness(record) {
  let score = 0;
  if (record.name) score += 15;
  if (record.whatsapp_number) score += 28;
  if (record.website) score += 14;
  if (Object.values(record.social_links || {}).some(Boolean)) score += 14;
  if (record.opening_hours) score += 8;
  if (record.address) score += 8;
  if (record.category && record.category !== 'business') score += 8;
  score += Math.max(0, 5 - Math.round(record.distance_km));
  return Math.min(score, 100);
}

function osmElementToLead(element, center, defaultCountryCode) {
  const tags = element.tags || {};
  const latitude = element.lat ?? element.center?.lat;
  const longitude = element.lon ?? element.center?.lon;
  if (!latitude || !longitude) return null;

  const phoneTag = firstTagWithKey(tags, ['contact:whatsapp', 'whatsapp', 'contact:mobile', 'mobile', 'contact:phone', 'phone']);
  const rawPhone = phoneTag.value;
  const whatsappNumber = normalizeWhatsappNumber(rawPhone, defaultCountryCode);
  if (!whatsappNumber) return null;
  const explicitWhatsappTag = phoneTag.key === 'contact:whatsapp' || phoneTag.key === 'whatsapp';
  const mobileCandidate = defaultCountryCode === '92' ? /^923\d{9}$/.test(whatsappNumber) : true;
  if (!explicitWhatsappTag && !mobileCandidate) return null;

  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  const address = [street, tags['addr:suburb'], tags['addr:city']].filter(Boolean).join(', ');
  const website = firstTag(tags, ['contact:website', 'website']);
  const distanceKm = haversineKm(center.latitude, center.longitude, latitude, longitude);
  const osmUrl = `https://www.openstreetmap.org/${element.type}/${element.id}`;
  const mapsQuery = [tags.name, address, tags['addr:city'] || 'Lahore', 'Pakistan']
    .filter(Boolean)
    .join(', ');
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`;

  const record = {
    place_id: `osm:${element.type}:${element.id}`,
    osm_type: element.type,
    osm_id: String(element.id),
    store_name: tags.name,
    phone: rawPhone,
    whatsapp_number: whatsappNumber,
    whatsapp_url: `https://wa.me/${whatsappNumber}`,
    area: null,
    category: detectCategory(tags),
    address: address || tags['addr:full'] || null,
    website,
    google_maps_url: googleMapsUrl,
    osm_url: osmUrl,
    business_status: 'OSM_LISTED',
    rating: null,
    review_count: 0,
    latitude,
    longitude,
    distance_km: Number(distanceKm.toFixed(2)),
    social_links: socialLinksFromTags(tags),
    opening_hours: tags.opening_hours || null,
    profile_data: {
      osm: element,
      tags,
      phone_tag: phoneTag.key,
      source: 'OPENSTREETMAP'
    }
  };

  record.lead_score = scoreOsmBusiness(record);
  return record;
}

async function geocodeOsm(query) {
  const response = await axios.get(NOMINATIM_URL, {
    timeout: 15000,
    headers: {
      'User-Agent': appUserAgent()
    },
    params: {
      q: query,
      format: 'jsonv2',
      limit: 1,
      countrycodes: 'pk',
      addressdetails: 1
    }
  });

  const result = response.data?.[0];
  if (!result) throw new Error(`Could not find "${query}" on OSM.`);

  return {
    latitude: Number(result.lat),
    longitude: Number(result.lon),
    display_name: result.display_name
  };
}

async function discoverOsmBusinesses({
  latitude,
  longitude,
  radiusKm = 5,
  categories,
  limit = 10,
  defaultCountryCode = '92'
}) {
  if (!Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) {
    throw new Error('Valid latitude and longitude are required.');
  }

  const center = {
    latitude: Number(latitude),
    longitude: Number(longitude)
  };
  const query = buildOverpassQuery({
    latitude: center.latitude,
    longitude: center.longitude,
    radiusKm,
    categories
  });

  const response = await axios.post(OVERPASS_URL, query, {
    timeout: 45000,
    headers: {
      'Content-Type': 'text/plain',
      'User-Agent': appUserAgent()
    }
  });

  const leads = (response.data?.elements || [])
    .map((element) => osmElementToLead(element, center, defaultCountryCode))
    .filter(Boolean)
    .sort((a, b) => b.lead_score - a.lead_score || a.distance_km - b.distance_km)
    .slice(0, parseLimit(limit, 10, 100));

  return {
    center,
    radius_km: clampRadiusKm(radiusKm),
    categories: normalizeCategories(categories),
    discovered_count: response.data?.elements?.length || 0,
    whatsapp_candidate_count: leads.length,
    leads
  };
}

module.exports = {
  DEFAULT_OSM_CATEGORIES,
  discoverOsmBusinesses,
  geocodeOsm,
  normalizeWhatsappNumber
};
