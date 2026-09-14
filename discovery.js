require('dotenv').config();

const axios = require('axios');
const cheerio = require('cheerio');

const DEFAULT_TYPES = [
  'restaurant',
  'cafe',
  'gym',
  'dentist',
  'beauty_salon',
  'clothing_store',
  'shoe_store',
  'jewelry_store',
  'furniture_store',
  'electronics_store',
  'pharmacy',
  'car_repair'
];

const SOCIAL_PATTERNS = {
  facebook: /facebook\.com/i,
  instagram: /instagram\.com/i,
  tiktok: /tiktok\.com/i,
  youtube: /youtube\.com/i,
  linkedin: /linkedin\.com/i,
  twitter: /(twitter\.com|x\.com)/i
};

function mapsHeaders(fieldMask) {
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    throw new Error('GOOGLE_MAPS_API_KEY is required for lead discovery.');
  }

  return {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
    'X-Goog-FieldMask': fieldMask
  };
}

function clampRadius(radiusKm) {
  const parsed = Number.parseFloat(radiusKm);
  if (!Number.isFinite(parsed) || parsed <= 0) return 5;
  return Math.min(parsed, 50);
}

function normalizeTypes(types) {
  if (Array.isArray(types) && types.length) {
    return types.map((type) => String(type).trim()).filter(Boolean).slice(0, 20);
  }

  if (typeof types === 'string' && types.trim()) {
    return types.split(',').map((type) => type.trim()).filter(Boolean).slice(0, 20);
  }

  return DEFAULT_TYPES;
}

async function geocodeArea(area) {
  if (!area) throw new Error('Area is required.');

  const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
    timeout: 15000,
    params: {
      address: area,
      region: 'pk',
      key: process.env.GOOGLE_MAPS_API_KEY
    }
  });

  const result = response.data?.results?.[0];
  if (!result?.geometry?.location) {
    throw new Error(`Could not locate area: ${area}`);
  }

  return {
    latitude: result.geometry.location.lat,
    longitude: result.geometry.location.lng,
    formatted_address: result.formatted_address
  };
}

async function searchNearby({ latitude, longitude, radiusKm, types }) {
  const places = new Map();
  const radius = clampRadius(radiusKm) * 1000;
  const includedTypes = normalizeTypes(types);
  const fieldMask = [
    'places.id',
    'places.displayName',
    'places.formattedAddress',
    'places.location',
    'places.primaryType',
    'places.types',
    'places.businessStatus',
    'places.rating',
    'places.userRatingCount',
    'places.websiteUri',
    'places.googleMapsUri',
    'places.nationalPhoneNumber',
    'places.internationalPhoneNumber'
  ].join(',');

  for (const type of includedTypes) {
    try {
      const response = await axios.post(
        'https://places.googleapis.com/v1/places:searchNearby',
        {
          includedTypes: [type],
          maxResultCount: 20,
          rankPreference: 'POPULARITY',
          locationRestriction: {
            circle: {
              center: {
                latitude,
                longitude
              },
              radius
            },
          },
          languageCode: 'en',
          regionCode: 'PK'
        },
        {
          timeout: 20000,
          headers: mapsHeaders(fieldMask)
        },
      );

      for (const place of response.data?.places || []) {
        if (!places.has(place.id)) {
          places.set(place.id, place);
        }
      }
    } catch (error) {
      console.warn(`[DISCOVERY] Skipped type "${type}": ${error.response?.data?.error?.message || error.message}`);
    }
  }

  return Array.from(places.values());
}

async function extractSocialLinks(website) {
  if (!website) return {};

  try {
    const response = await axios.get(website, {
      timeout: 12000,
      maxRedirects: 4,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; lead-engine/1.0)'
      }
    });

    const $ = cheerio.load(response.data);
    const socialLinks = {};

    $('a[href]').each((_, element) => {
      const href = $(element).attr('href');
      if (!href) return;

      for (const [network, pattern] of Object.entries(SOCIAL_PATTERNS)) {
        if (!socialLinks[network] && pattern.test(href)) {
          try {
            socialLinks[network] = new URL(href, website).toString();
          } catch (_) {
            socialLinks[network] = href;
          }
        }
      }
    });

    return socialLinks;
  } catch (_) {
    return {};
  }
}

function scorePlace(place, socialLinks = {}) {
  const rating = Number(place.rating || 0);
  const reviewCount = Number(place.userRatingCount || 0);
  const hasWebsite = Boolean(place.websiteUri);
  const hasPhone = Boolean(place.internationalPhoneNumber || place.nationalPhoneNumber);
  const socialCount = Object.keys(socialLinks).length;
  const activeBonus = place.businessStatus === 'OPERATIONAL' ? 10 : 0;

  let score = 0;
  score += Math.round(rating * 12);
  score += Math.min(Math.round(reviewCount / 8), 35);
  score += hasWebsite ? 12 : 0;
  score += hasPhone ? 18 : 0;
  score += Math.min(socialCount * 6, 18);
  score += activeBonus;

  return Math.min(score, 100);
}

async function enrichPlaces(places, options = {}) {
  const enriched = [];

  for (const place of places) {
    const socialLinks = options.includeSocial === false
      ? {}
      : await extractSocialLinks(place.websiteUri);

    const score = scorePlace(place, socialLinks);

    enriched.push({
      place_id: place.id,
      store_name: place.displayName?.text || 'Unknown business',
      phone: place.internationalPhoneNumber || place.nationalPhoneNumber || null,
      area: options.area || null,
      category: place.primaryType || place.types?.[0] || null,
      address: place.formattedAddress || null,
      website: place.websiteUri || null,
      google_maps_url: place.googleMapsUri || null,
      business_status: place.businessStatus || null,
      rating: place.rating || null,
      review_count: place.userRatingCount || 0,
      latitude: place.location?.latitude || null,
      longitude: place.location?.longitude || null,
      social_links: socialLinks,
      lead_score: score,
      profile_data: place
    });
  }

  return enriched.sort((a, b) => b.lead_score - a.lead_score);
}

async function discoverBusinesses({ area, radiusKm = 5, types, limit = 10, includeSocial = true }) {
  const center = await geocodeArea(area);
  const places = await searchNearby({
    latitude: center.latitude,
    longitude: center.longitude,
    radiusKm,
    types
  });
  const finalLimit = Math.min(Number.parseInt(limit, 10) || 10, 25);
  const candidateLimit = Math.max(finalLimit * 3, 25);
  const candidates = places
    .map((place) => ({ place, baseScore: scorePlace(place, {}) }))
    .sort((a, b) => b.baseScore - a.baseScore)
    .slice(0, candidateLimit)
    .map((item) => item.place);

  const enriched = await enrichPlaces(candidates, {
    area,
    includeSocial
  });

  return {
    area,
    center,
    radius_km: clampRadius(radiusKm),
    discovered_count: places.length,
    enriched_count: enriched.length,
    shortlisted: enriched.slice(0, finalLimit)
  };
}

module.exports = {
  DEFAULT_TYPES,
  discoverBusinesses,
  extractSocialLinks,
  geocodeArea,
  scorePlace
};
