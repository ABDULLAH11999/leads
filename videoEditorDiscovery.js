require('dotenv').config();

const crypto = require('crypto');
const axios = require('axios');
const cheerio = require('cheerio');

const USER_AGENT = process.env.SOCIAL_DISCOVERY_USER_AGENT
  || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 lead-engine/1.0';

const SEARCH_PROVIDERS = (process.env.SOCIAL_SEARCH_PROVIDERS || 'duckduckgo,bing')
  .split(',')
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

const VIDEO_EDITOR_KEYWORDS = [
  'video editor',
  'freelance video editor',
  'short form video editor',
  'reels editor',
  'tiktok video editor',
  'youtube video editor',
  'motion graphics editor',
  'after effects editor',
  'capcut editor',
  'post production editor',
  'social media video editor',
  'wedding video editor'
];

const VIDEO_EDITOR_LOCATIONS = [
  { code: 'PK', name: 'Pakistan', cities: ['Lahore', 'Karachi', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Peshawar', 'Quetta', 'Sialkot', 'Gujranwala'] },
  { code: 'US', name: 'United States', cities: ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia', 'San Diego', 'Dallas', 'Austin', 'Miami'] },
  { code: 'GB', name: 'United Kingdom', cities: ['London', 'Manchester', 'Birmingham', 'Leeds', 'Glasgow', 'Liverpool', 'Bristol', 'Edinburgh'] },
  { code: 'IN', name: 'India', cities: ['Mumbai', 'Delhi', 'Bengaluru', 'Hyderabad', 'Chennai', 'Kolkata', 'Pune', 'Ahmedabad', 'Jaipur', 'Chandigarh'] },
  { code: 'AE', name: 'United Arab Emirates', cities: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah'] },
  { code: 'CA', name: 'Canada', cities: ['Toronto', 'Vancouver', 'Montreal', 'Calgary', 'Ottawa', 'Edmonton', 'Mississauga'] },
  { code: 'AU', name: 'Australia', cities: ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Canberra', 'Gold Coast'] },
  { code: 'SA', name: 'Saudi Arabia', cities: ['Riyadh', 'Jeddah', 'Dammam', 'Mecca', 'Medina', 'Khobar'] },
  { code: 'DE', name: 'Germany', cities: ['Berlin', 'Munich', 'Hamburg', 'Frankfurt', 'Cologne', 'Dusseldorf'] },
  { code: 'FR', name: 'France', cities: ['Paris', 'Lyon', 'Marseille', 'Toulouse', 'Nice', 'Bordeaux'] }
];

const VIDEO_EDITOR_PLATFORMS = {
  instagram: {
    label: 'Instagram',
    site: 'instagram.com',
    hostPattern: /(^|\.)instagram\.com$/i
  },
  facebook: {
    label: 'Facebook',
    site: 'facebook.com',
    hostPattern: /(^|\.)facebook\.com$/i
  },
  tiktok: {
    label: 'TikTok',
    site: 'tiktok.com',
    hostPattern: /(^|\.)tiktok\.com$/i
  }
};

const BAD_INSTAGRAM_PATHS = new Set([
  'accounts',
  'explore',
  'p',
  'reel',
  'reels',
  'feed',
  'foryou',
  'stories',
  'tv',
  'videos',
  'watch',
  'developer',
  'about',
  'directory',
  'en',
  'html',
  'privacy',
  'terms',
  'oauth',
  'challenge'
]);

const BAD_FACEBOOK_PATHS = new Set([
  'groups',
  'watch',
  'marketplace',
  'events',
  'gaming',
  'hashtag',
  'help',
  'login',
  'messages',
  'pages',
  'people',
  'photo',
  'photos',
  'plugins',
  'posts',
  'reel',
  'reels',
  'search',
  'share',
  'sharer',
  'stories',
  'videos'
]);

function parseLimit(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function normalizeLocation(country, city) {
  const normalizedCountry = String(country || '').trim();
  const normalizedCity = String(city || '').trim();
  const countryRecord = VIDEO_EDITOR_LOCATIONS.find((item) => {
    return item.code.toLowerCase() === normalizedCountry.toLowerCase()
      || item.name.toLowerCase() === normalizedCountry.toLowerCase();
  });

  if (!countryRecord) throw new Error('A supported country is required.');

  const cityRecord = countryRecord.cities.find((item) => item.toLowerCase() === normalizedCity.toLowerCase());
  if (!cityRecord) throw new Error(`A supported city for ${countryRecord.name} is required.`);

  return {
    country: countryRecord.name,
    country_code: countryRecord.code,
    city: cityRecord
  };
}

function normalizePlatforms(platforms) {
  const values = Array.isArray(platforms)
    ? platforms
    : String(platforms || '').split(',');

  const normalized = values
    .map((item) => String(item).trim().toLowerCase())
    .filter((item) => VIDEO_EDITOR_PLATFORMS[item]);

  return normalized.length ? Array.from(new Set(normalized)) : Object.keys(VIDEO_EDITOR_PLATFORMS);
}

function normalizeKeywords(keywords) {
  if (Array.isArray(keywords) && keywords.length) {
    return keywords.map((item) => String(item).trim()).filter(Boolean).slice(0, 18);
  }

  if (typeof keywords === 'string' && keywords.trim()) {
    return keywords.split(',').map((item) => item.trim()).filter(Boolean).slice(0, 18);
  }

  return VIDEO_EDITOR_KEYWORDS;
}

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseCompactNumber(number, suffix) {
  const parsed = Number.parseFloat(String(number || '').replace(/,/g, ''));
  if (!Number.isFinite(parsed)) return null;

  const normalizedSuffix = String(suffix || '').toLowerCase();
  const multiplier = normalizedSuffix === 'b'
    ? 1000000000
    : normalizedSuffix === 'm'
      ? 1000000
      : normalizedSuffix === 'k'
        ? 1000
        : 1;

  return Math.round(parsed * multiplier);
}

function extractFollowerCount(text) {
  const normalized = compactText(text).replace(/\u00a0/g, ' ');
  const patterns = [
    /([\d][\d,.]*)\s*([kmb])?\s+(?:followers|follower|fans)\b/i,
    /(?:followers|follower|fans)\D{0,18}([\d][\d,.]*)\s*([kmb])?/i,
    /([\d][\d,.]*)\s*([kmb])?\s+people\s+follow/i
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) return parseCompactNumber(match[1], match[2]);
  }

  return null;
}

function extractJsonFollowerCount(html) {
  const patterns = [
    /"followerCount"\s*:\s*(\d+)/i,
    /"followersCount"\s*:\s*(\d+)/i,
    /"follower_count"\s*:\s*(\d+)/i,
    /"edge_followed_by"\s*:\s*\{\s*"count"\s*:\s*(\d+)/i
  ];

  for (const pattern of patterns) {
    const match = String(html || '').match(pattern);
    if (match) return Number.parseInt(match[1], 10);
  }

  return null;
}

function followerStatus(followers, minFollowers, maxFollowers) {
  if (followers === null || followers === undefined) return 'not_public';
  if (followers < minFollowers) return 'below_range';
  if (followers > maxFollowers) return 'above_range';
  return 'verified';
}

function profileId(url) {
  return crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
}

function cleanSearchHref(href) {
  if (!href) return null;

  try {
    const parsed = new URL(String(href).replace(/&amp;/g, '&'), 'https://duckduckgo.com');
    const redirected = parsed.searchParams.get('uddg');
    if (redirected) return redirected;

    const bingRedirect = parsed.searchParams.get('u');
    if (bingRedirect && /(^|\.)bing\.com$/i.test(parsed.hostname)) {
      const encoded = bingRedirect.startsWith('a1') ? bingRedirect.slice(2) : bingRedirect;
      try {
        return Buffer.from(encoded, 'base64').toString('utf8');
      } catch (_) {
        return parsed.toString();
      }
    }

    return parsed.toString();
  } catch (_) {
    return null;
  }
}

function platformFromHost(hostname) {
  const host = String(hostname || '').replace(/^www\./i, '').replace(/^m\./i, '').toLowerCase();
  return Object.entries(VIDEO_EDITOR_PLATFORMS).find(([, config]) => config.hostPattern.test(host))?.[0] || null;
}

function normalizeSocialProfileUrl(rawUrl, forcedPlatform = null) {
  const cleaned = cleanSearchHref(rawUrl);
  if (!cleaned) return null;

  let parsed;
  try {
    parsed = new URL(cleaned);
  } catch (_) {
    return null;
  }

  const platform = forcedPlatform || platformFromHost(parsed.hostname);
  if (!platform) return null;

  const parts = parsed.pathname.split('/').map((item) => item.trim()).filter(Boolean);

  if (platform === 'instagram') {
    const username = parts[0]?.replace(/^@/, '');
    if (!username || BAD_INSTAGRAM_PATHS.has(username.toLowerCase())) return null;
    if (/^[a-z]{2}(?:-[a-z]{2})?$/i.test(username)) return null;
    return {
      platform,
      handle: username,
      profile_url: `https://www.instagram.com/${username}/`
    };
  }

  if (platform === 'tiktok') {
    const username = parts.find((item) => item.startsWith('@'))?.slice(1);
    if (!username) return null;
    return {
      platform,
      handle: username,
      profile_url: `https://www.tiktok.com/@${username}`
    };
  }

  if (platform === 'facebook') {
    if (parsed.pathname === '/profile.php' && parsed.searchParams.get('id')) {
      const id = parsed.searchParams.get('id');
      return {
        platform,
        handle: id,
        profile_url: `https://www.facebook.com/profile.php?id=${encodeURIComponent(id)}`
      };
    }

    const first = parts[0];
    if (!first || BAD_FACEBOOK_PATHS.has(first.toLowerCase())) return null;

    return {
      platform,
      handle: first,
      profile_url: `https://www.facebook.com/${first}`
    };
  }

  return null;
}

function accountNameFromTitle(title, handle) {
  const cleaned = compactText(title)
    .replace(/\s*\|\s*(Instagram|Facebook|TikTok).*$/i, '')
    .replace(/\s*-\s*(Instagram|Facebook|TikTok).*$/i, '')
    .replace(/^@/, '');

  return cleaned || handle;
}

function scoreCandidate(candidate) {
  const haystack = `${candidate.display_name} ${candidate.handle} ${candidate.snippet} ${candidate.profile_url}`.toLowerCase();
  let score = 0;

  for (const keyword of VIDEO_EDITOR_KEYWORDS) {
    const compactKeyword = keyword.toLowerCase();
    if (haystack.includes(compactKeyword)) score += 12;
  }

  if (/video|editor|editing|reels|tiktok|youtube|motion|after effects|capcut|post production/i.test(haystack)) score += 22;
  if (candidate.followers !== null && candidate.followers !== undefined) score += 16;
  if (candidate.follower_status === 'verified') score += 24;
  if (candidate.platform === 'instagram') score += 5;
  if (candidate.platform === 'tiktok') score += 4;

  return Math.min(score, 100);
}

function buildQueries({ country, city, platforms, keywords, maxQueries }) {
  const queries = [];
  const keywordList = normalizeKeywords(keywords);

  for (const platform of platforms) {
    const config = VIDEO_EDITOR_PLATFORMS[platform];
    for (const keyword of keywordList) {
      queries.push({
        platform,
        keyword,
        q: `${keyword} ${city} ${country} site:${config.site}`
      });
    }
  }

  return queries.slice(0, maxQueries);
}

async function fetchSearchHtml(provider, q) {
  const endpoint = provider === 'bing'
    ? 'https://www.bing.com/search'
    : 'https://html.duckduckgo.com/html/';

  const response = await axios.get(endpoint, {
    timeout: 16000,
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml'
    },
    params: { q }
  });

  return response.data;
}

function resultFromUrl({ href, title, snippet, platform, keyword, provider, query }) {
  const normalized = normalizeSocialProfileUrl(href, platform);
  if (!normalized) return null;

  return {
    ...normalized,
    platform_label: VIDEO_EDITOR_PLATFORMS[normalized.platform].label,
    display_name: accountNameFromTitle(title, normalized.handle),
    snippet: compactText(snippet),
    matched_keywords: [keyword],
    search_query: query,
    source: `public_search:${provider}`
  };
}

function parseSearchResults(html, { q, platform, keyword, provider }) {
  const $ = cheerio.load(html);
  const results = [];

  $('.result, .web-result').each((_, element) => {
    const anchor = $(element).find('a.result__a').first();
    const result = resultFromUrl({
      href: anchor.attr('href'),
      title: anchor.text(),
      snippet: $(element).find('.result__snippet').text(),
      platform,
      keyword,
      provider,
      query: q
    });
    if (result) results.push(result);
  });

  $('li.b_algo, .b_algo').each((_, element) => {
    const anchor = $(element).find('h2 a, a').first();
    const result = resultFromUrl({
      href: anchor.attr('href'),
      title: anchor.text(),
      snippet: $(element).find('.b_caption p, p').first().text(),
      platform,
      keyword,
      provider,
      query: q
    });
    if (result) results.push(result);
  });

  if (results.length) return results;

  $('a[href]').each((_, element) => {
    const anchor = $(element);
    const result = resultFromUrl({
      href: anchor.attr('href'),
      title: anchor.text(),
      snippet: anchor.closest('div, li, article').text(),
      platform,
      keyword,
      provider,
      query: q
    });
    if (result) results.push(result);
  });

  const socialUrlPattern = /https?:\/\/(?:www\.|m\.)?(?:instagram\.com|facebook\.com|tiktok\.com)\/[^"'<>\s)]+/gi;
  for (const match of String(html || '').match(socialUrlPattern) || []) {
    const result = resultFromUrl({
      href: match,
      title: '',
      snippet: '',
      platform,
      keyword,
      provider,
      query: q
    });
    if (result) results.push(result);
  }

  const unique = new Map();
  for (const result of results) {
    if (!unique.has(result.profile_url)) unique.set(result.profile_url, result);
  }

  return Array.from(unique.values());
}

async function searchProfiles(query) {
  let lastError = null;

  for (const provider of SEARCH_PROVIDERS.length ? SEARCH_PROVIDERS : ['duckduckgo', 'bing']) {
    try {
      const html = await fetchSearchHtml(provider, query.q);
      const results = parseSearchResults(html, { ...query, provider });
      if (results.length) return results;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) throw lastError;
  return [];
}

async function fetchProfileMetadata(account) {
  try {
    const response = await axios.get(account.profile_url, {
      timeout: 11000,
      maxRedirects: 4,
      validateStatus: (status) => status >= 200 && status < 500,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml'
      }
    });

    if (response.status >= 400) {
      return {
        ...account,
        verification_error: `Profile returned HTTP ${response.status}`
      };
    }

    const html = String(response.data || '');
    const $ = cheerio.load(html);
    const title = $('meta[property="og:title"]').attr('content') || $('title').first().text();
    const description = $('meta[property="og:description"]').attr('content')
      || $('meta[name="description"]').attr('content')
      || account.snippet;
    const followers = extractJsonFollowerCount(html) ?? extractFollowerCount(`${description} ${title} ${account.snippet}`);

    return {
      ...account,
      display_name: accountNameFromTitle(title, account.handle) || account.display_name,
      bio: compactText(description).slice(0, 260),
      followers
    };
  } catch (error) {
    return {
      ...account,
      verification_error: error.message
    };
  }
}

async function runBatches(items, size, worker) {
  const output = [];
  for (let index = 0; index < items.length; index += size) {
    const batch = items.slice(index, index + size);
    const batchResults = await Promise.all(batch.map(worker));
    output.push(...batchResults.flat());
  }
  return output;
}

async function discoverVideoEditorAccounts(options = {}) {
  const location = normalizeLocation(options.country, options.city);
  const platforms = normalizePlatforms(options.platforms);
  const limit = parseLimit(options.limit, 50, 50);
  const minFollowers = Math.max(Number.parseInt(options.min_followers ?? options.minFollowers ?? 1, 10) || 1, 1);
  const maxFollowers = Math.min(Number.parseInt(options.max_followers ?? options.maxFollowers ?? 100000, 10) || 100000, 1000000);
  const includeUnverified = options.include_unverified !== false && options.includeUnverified !== false;
  const maxQueries = parseLimit(options.max_queries ?? options.maxQueries, Math.max(18, platforms.length * 6), 36);
  const queries = buildQueries({
    country: location.country,
    city: location.city,
    platforms,
    keywords: options.keywords,
    maxQueries
  });

  const found = new Map();
  const queryErrors = [];

  const searchResults = await runBatches(queries, 3, async (query) => {
    try {
      return await searchProfiles(query);
    } catch (error) {
      queryErrors.push({ query: query.q, error: error.message });
      return [];
    }
  });

  for (const result of searchResults) {
    const existing = found.get(result.profile_url);
    if (existing) {
      existing.matched_keywords = Array.from(new Set([...existing.matched_keywords, ...result.matched_keywords]));
      if (!existing.snippet && result.snippet) existing.snippet = result.snippet;
    } else {
      found.set(result.profile_url, result);
    }
  }

  const candidates = Array.from(found.values()).slice(0, Math.max(limit * 3, 90));
  const enriched = await runBatches(candidates, 5, fetchProfileMetadata);

  const scored = enriched.map((account) => {
    const followers = account.followers ?? extractFollowerCount(account.snippet);
    const status = followerStatus(followers, minFollowers, maxFollowers);
    const normalized = {
      ...account,
      id: profileId(account.profile_url),
      followers,
      follower_status: status,
      country: location.country,
      country_code: location.country_code,
      city: location.city
    };

    normalized.score = scoreCandidate(normalized);
    return normalized;
  });

  const verified = scored
    .filter((account) => account.follower_status === 'verified')
    .sort((a, b) => b.score - a.score || (a.followers || 0) - (b.followers || 0));

  const unverified = scored
    .filter((account) => account.follower_status === 'not_public')
    .sort((a, b) => b.score - a.score);

  const accounts = (includeUnverified ? [...verified, ...unverified] : verified).slice(0, limit);

  return {
    ...location,
    platforms,
    limit,
    min_followers: minFollowers,
    max_followers: maxFollowers,
    include_unverified: includeUnverified,
    query_count: queries.length,
    discovered_count: found.size,
    verified_count: verified.length,
    returned_count: accounts.length,
    query_errors: queryErrors.slice(0, 8),
    accounts
  };
}

module.exports = {
  VIDEO_EDITOR_KEYWORDS,
  VIDEO_EDITOR_LOCATIONS,
  VIDEO_EDITOR_PLATFORMS,
  discoverVideoEditorAccounts,
  extractFollowerCount,
  normalizeSocialProfileUrl
};
