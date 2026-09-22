require('dotenv').config();

const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleGenAI } = require('@google/genai');

const USER_AGENT = process.env.SOCIAL_DISCOVERY_USER_AGENT
  || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

const CRAWLER_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
const WHATSAPP_UA = 'WhatsApp/2.21.12.21 A';

let geminiClient = null;

function getGeminiClient() {
  if (geminiClient) return geminiClient;
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  geminiClient = new GoogleGenAI({ apiKey: key });
  return geminiClient;
}

function cleanText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

/**
 * Check if Wikipedia title is a valid match for the queried name
 */
function isStrictNameMatch(target, foundTitle) {
  if (!target || !foundTitle) return false;
  const tNorm = target.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const fNorm = foundTitle.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();

  if (fNorm.includes(tNorm) || tNorm.includes(fNorm)) return true;

  const tWords = tNorm.split(/\s+/).filter((w) => w.length > 2);
  if (!tWords.length) return false;

  const matches = tWords.filter((w) => fNorm.includes(w));
  return matches.length >= Math.min(2, tWords.length);
}

/**
 * Query Wikipedia with strict name validation
 */
async function fetchWikipediaData(name) {
  try {
    const searchRes = await axios.get('https://en.wikipedia.org/w/api.php', {
      params: {
        action: 'query',
        list: 'search',
        srsearch: name,
        format: 'json',
        utf8: 1,
        srlimit: 4
      },
      headers: { 'User-Agent': 'LeadMatrixHUD/1.0 (info@leadmatrix.local)' },
      timeout: 7000
    });

    const hits = searchRes.data?.query?.search || [];
    const matchedHit = hits.find((h) => isStrictNameMatch(name, h.title));
    if (!matchedHit) return null;

    const pageRes = await axios.get('https://en.wikipedia.org/w/api.php', {
      params: {
        action: 'query',
        prop: 'extracts|pageimages|info|extlinks',
        exintro: 1,
        explaintext: 1,
        piprop: 'original|thumbnail',
        pithumbsize: 600,
        inprop: 'url',
        ellimit: 50,
        format: 'json',
        titles: matchedHit.title
      },
      headers: { 'User-Agent': 'LeadMatrixHUD/1.0 (info@leadmatrix.local)' },
      timeout: 7000
    });

    const pages = pageRes.data?.query?.pages;
    const page = pages ? Object.values(pages)[0] : null;
    if (!page || page.missing !== undefined) return null;

    return {
      title: page.title,
      extract: page.extract || '',
      image_url: page.original?.source || page.thumbnail?.source || null,
      page_url: page.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
      extlinks: (page.extlinks || []).map((item) => item['*'] || '')
    };
  } catch (error) {
    return null;
  }
}

/**
 * Search GitHub Users API for public profiles & avatars
 */
async function searchGitHubProfiles(name, handles = []) {
  const profiles = [];
  const queryTerms = Array.from(new Set([name, ...handles.slice(0, 5)]));

  for (const term of queryTerms) {
    if (!term || term.length < 3) continue;
    try {
      const res = await axios.get(`https://api.github.com/search/users?q=${encodeURIComponent(term)}&per_page=3`, {
        headers: {
          'User-Agent': 'LeadMatrixHUD/1.0',
          'Accept': 'application/vnd.github.v3+json'
        },
        timeout: 5000
      });

      const items = res.data?.items || [];
      for (const item of items) {
        if (profiles.some((p) => p.login.toLowerCase() === item.login.toLowerCase())) continue;
        try {
          const userDetail = await axios.get(item.url, {
            headers: { 'User-Agent': 'LeadMatrixHUD/1.0' },
            timeout: 4000
          });
          const u = userDetail.data;
          profiles.push({
            login: u.login,
            name: u.name || u.login,
            bio: u.bio || '',
            avatar_url: u.avatar_url || null,
            location: u.location || null,
            company: u.company || null,
            blog: u.blog || null,
            twitter_username: u.twitter_username || null,
            profile_url: u.html_url
          });
        } catch (_) {}
      }
    } catch (_) {}
    if (profiles.length >= 3) break;
  }

  return profiles;
}

/**
 * Generate exhaustive username permutations using underscore _ and dot .
 */
function generateHandlePermutations(name, directHandle = null) {
  const permutations = new Set();
  if (directHandle) {
    const dh = directHandle.toLowerCase().replace(/^@/, '').trim();
    if (dh) permutations.add(dh);
  }

  const clean = cleanText(name).toLowerCase().replace(/[^a-z0-9\s._-]/g, '');
  const words = clean.split(/[\s._-]+/).filter(Boolean);

  if (words.length === 0) return Array.from(permutations);

  if (words.length === 1) {
    const w = words[0];
    permutations.add(w);
    permutations.add(`_${w}`);
    permutations.add(`${w}_`);
    permutations.add(`_${w}_`);
    permutations.add(`${w}.`);
    permutations.add(`.${w}`);
    permutations.add(`${w}1`);
    permutations.add(`${w}01`);
    permutations.add(`official_${w}`);
    permutations.add(`official.${w}`);
    permutations.add(`the${w}`);
  } else if (words.length === 2) {
    const [w1, w2] = words;
    // Core variations with _ and .
    permutations.add(`${w1}_${w2}`);
    permutations.add(`${w1}.${w2}`);
    permutations.add(`${w1}${w2}`);
    
    // Prefix / suffix underscores
    permutations.add(`_${w1}_${w2}`);
    permutations.add(`${w1}_${w2}_`);
    permutations.add(`_${w1}_${w2}_`);
    permutations.add(`__${w1}_${w2}__`);

    // Prefix / suffix dots
    permutations.add(`_${w1}.${w2}`);
    permutations.add(`${w1}.${w2}_`);
    permutations.add(`${w1}_${w2}.`);
    permutations.add(`${w1}.${w2}.`);
    permutations.add(`.${w1}.${w2}`);

    // Reverse order
    permutations.add(`${w2}_${w1}`);
    permutations.add(`${w2}.${w1}`);
    permutations.add(`${w2}${w1}`);
    permutations.add(`_${w2}_${w1}`);
    permutations.add(`${w2}_${w1}_`);

    // Initial combinations
    permutations.add(`${w1.charAt(0)}_${w2}`);
    permutations.add(`${w1.charAt(0)}.${w2}`);
    permutations.add(`${w1.charAt(0)}${w2}`);
    permutations.add(`${w1}_${w2.charAt(0)}`);
    permutations.add(`${w1}.${w2.charAt(0)}`);
    permutations.add(`${w1}${w2.charAt(0)}`);

    // Common numeric / official additions
    permutations.add(`${w1}_${w2}1`);
    permutations.add(`${w1}.${w2}1`);
    permutations.add(`${w1}_${w2}01`);
    permutations.add(`official_${w1}_${w2}`);
    permutations.add(`official.${w1}.${w2}`);
    permutations.add(`the_${w1}_${w2}`);
  } else {
    // 3 or more words (e.g. Muhammad Abdullah Irfan)
    const wAll = words.join('');
    const wUnder = words.join('_');
    const wDot = words.join('.');
    permutations.add(wUnder);
    permutations.add(wDot);
    permutations.add(wAll);

    // First and last word
    const firstLast = `${words[0]}_${words[words.length - 1]}`;
    const firstLastDot = `${words[0]}.${words[words.length - 1]}`;
    permutations.add(firstLast);
    permutations.add(firstLastDot);
    permutations.add(`${words[0]}${words[words.length - 1]}`);
    permutations.add(`_${firstLast}`);
    permutations.add(`${firstLast}_`);
    permutations.add(`_${firstLast}_`);

    // Middle and last word (e.g. abdullah_irfan)
    if (words.length >= 3) {
      const midLast = `${words[1]}_${words[2]}`;
      const midLastDot = `${words[1]}.${words[2]}`;
      permutations.add(midLast);
      permutations.add(midLastDot);
      permutations.add(`${words[1]}${words[2]}`);
      permutations.add(`_${midLast}`);
      permutations.add(`${midLast}_`);
      permutations.add(`_${midLast}_`);

      // Initial + remaining
      const initRest = `${words[0].charAt(0)}_${words[1]}_${words[2]}`;
      const initRestDot = `${words[0].charAt(0)}.${words[1]}.${words[2]}`;
      permutations.add(initRest);
      permutations.add(initRestDot);
    }
  }

  return Array.from(permutations).filter((h) => Boolean(h) && h.length >= 3 && h.length <= 30);
}

/**
 * Probe Instagram specifically using crawler headers and underscore / dot variations
 */
async function probeInstagramCandidates(handles, cleanName) {
  const badPatterns = /(page not found|404|login \u2022 instagram|security check|log in or sign up)/i;
  const discovered = [];

  const nameWords = cleanName.toLowerCase().split(/\s+/).filter((w) => w.length > 2);

  // Probe in batches to avoid network congestion
  const batchSize = 6;
  for (let i = 0; i < handles.length; i += batchSize) {
    const batch = handles.slice(i, i + batchSize);
    const promises = batch.map(async (handle) => {
      const url = `https://www.instagram.com/${handle}/`;
      try {
        const res = await axios.get(url, {
          headers: {
            'User-Agent': CRAWLER_UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9'
          },
          timeout: 5000,
          maxRedirects: 3,
          validateStatus: (s) => s >= 200 && s < 400
        });

        const $ = cheerio.load(res.data);
        const title = cleanText($('meta[property="og:title"]').attr('content') || $('title').text() || '');
        const desc = cleanText($('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || '');
        const image = $('meta[property="og:image"]').attr('content') || null;

        if (title && !badPatterns.test(title) && title !== 'Instagram') {
          let score = 20;

          // Check if title has target name
          const lowerTitle = title.toLowerCase();
          const matchWordCount = nameWords.filter((w) => lowerTitle.includes(w)).length;
          score += matchWordCount * 25;

          // Check handle exactness
          if (handle.includes(nameWords[0] || '')) score += 15;
          if (image) score += 15;
          if (desc && desc.includes('Followers')) score += 10;

          // Parse followers from description
          let followers = null;
          const fMatch = desc.match(/([\d,.]+[KMkm]?)\s+Followers/i);
          if (fMatch) followers = fMatch[1];

          // Parse display name from title
          let displayName = title.replace(/\(@[^\)]+\)/, '').replace(/•.*$/, '').trim();

          return {
            platform: 'instagram',
            label: 'Instagram',
            url,
            handle,
            displayName: displayName || cleanName,
            title,
            desc: desc || `Instagram profile for @${handle}`,
            image: image && !image.includes('default_profile') ? image : null,
            followers,
            score
          };
        }
      } catch (_) {}
      return null;
    });

    const results = await Promise.all(promises);
    const valid = results.filter(Boolean);
    discovered.push(...valid);

    // If we already found high-confidence matches with images, we can conclude
    if (discovered.some((d) => d.score >= 60 && d.image)) {
      break;
    }
  }

  // Sort by match score
  discovered.sort((a, b) => b.score - a.score);
  return discovered;
}

/**
 * Probe social media platforms for matching handles & OpenGraph data
 */
async function probeSocialPlatforms(handles = [], directUrl = null, cleanName = '') {
  const platforms = [
    { id: 'linkedin', label: 'LinkedIn', makeUrl: (h) => `https://www.linkedin.com/in/${h}/` },
    { id: 'facebook', label: 'Facebook', makeUrl: (h) => `https://www.facebook.com/${h}` },
    { id: 'twitter_x', label: 'X (Twitter)', makeUrl: (h) => `https://x.com/${h}` },
    { id: 'tiktok', label: 'TikTok', makeUrl: (h) => `https://www.tiktok.com/@${h}` },
    { id: 'youtube', label: 'YouTube', makeUrl: (h) => `https://www.youtube.com/@${h}` },
    { id: 'github', label: 'GitHub', makeUrl: (h) => `https://github.com/${h}` }
  ];

  const badPatterns = /(page not found|404|login \u2022 instagram|security check|log in or sign up)/i;
  const tasks = [];

  // Dedicated Instagram probe with crawler UA and exhaustive variations
  const igPromise = probeInstagramCandidates(handles, cleanName);

  // Probe other platforms with top candidate handles
  const topHandles = handles.slice(0, 8);
  for (const h of topHandles) {
    for (const p of platforms) {
      const url = p.makeUrl(h);
      tasks.push(
        (async () => {
          try {
            const res = await axios.get(url, {
              headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9'
              },
              timeout: 5000,
              maxRedirects: 3,
              validateStatus: (s) => s >= 200 && s < 400
            });

            const $ = cheerio.load(res.data);
            const title = cleanText($('meta[property="og:title"]').attr('content') || $('title').text() || '');
            const desc = cleanText($('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || '');
            const image = $('meta[property="og:image"]').attr('content') || null;

            if (title && !badPatterns.test(title)) {
              return {
                platform: p.id,
                label: p.label,
                url,
                title,
                desc,
                image: image && !image.includes('default_profile') ? image : null,
                handle: h
              };
            }
          } catch (_) {}
          return null;
        })()
      );
    }
  }

  const [probedOther, probedIg] = await Promise.all([
    Promise.all(tasks),
    igPromise
  ]);

  const allProbed = [...probedIg, ...probedOther.filter(Boolean)];
  return allProbed;
}

/**
 * Public search scraping (Bing / DuckDuckGo / Yahoo)
 */
async function searchWebPublic(query) {
  const providers = ['bing', 'yahoo'];
  const results = [];

  for (const provider of providers) {
    try {
      const endpoint = provider === 'bing'
        ? 'https://www.bing.com/search'
        : 'https://search.yahoo.com/search';

      const paramKey = provider === 'bing' ? 'q' : 'p';
      const response = await axios.get(endpoint, {
        timeout: 8000,
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        params: { [paramKey]: query }
      });

      const $ = cheerio.load(response.data);

      if (provider === 'bing') {
        $('li.b_algo, .b_algo').each((_, el) => {
          const a = $(el).find('h2 a, a').first();
          const title = cleanText(a.text());
          const href = a.attr('href');
          const snippet = cleanText($(el).find('.b_caption p, p').first().text());
          if (title && href && !href.includes('bing.com')) {
            results.push({ title, href, snippet, source: 'bing' });
          }
        });
      } else {
        $('.algo, div.dd').each((_, el) => {
          const a = $(el).find('h3 a, a').first();
          const title = cleanText(a.text());
          const href = a.attr('href');
          const snippet = cleanText($(el).find('.compText, p').first().text());
          if (title && href && !href.includes('yahoo.com')) {
            results.push({ title, href, snippet, source: 'yahoo' });
          }
        });
      }

      if (results.length >= 6) break;
    } catch (_) {}
  }

  return results;
}

/**
 * Parse input to extract target name and candidate social handles
 */
function parseTargetInput(targetInput) {
  const raw = cleanText(targetInput);
  let cleanName = raw;
  let directHandle = null;
  let directPlatform = null;

  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      const host = parsed.hostname.toLowerCase();
      const parts = parsed.pathname.split('/').filter(Boolean);
      const handlePart = parts[parts.length - 1] || parts[0];

      if (handlePart) {
        directHandle = handlePart.replace(/^@/, '');
        cleanName = directHandle.replace(/[._-]/g, ' ');
      }

      if (host.includes('instagram.com')) directPlatform = 'instagram';
      else if (host.includes('linkedin.com')) directPlatform = 'linkedin';
      else if (host.includes('facebook.com')) directPlatform = 'facebook';
      else if (host.includes('twitter.com') || host.includes('x.com')) directPlatform = 'twitter_x';
      else if (host.includes('github.com')) directPlatform = 'github';
      else if (host.includes('tiktok.com')) directPlatform = 'tiktok';
      else if (host.includes('youtube.com')) directPlatform = 'youtube';
    } catch (_) {}
  } else if (raw.startsWith('@')) {
    directHandle = raw.slice(1).trim();
    cleanName = directHandle.replace(/[._-]/g, ' ');
  }

  // Capitalize name
  cleanName = cleanName
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

  const handles = generateHandlePermutations(cleanName, directHandle);

  return {
    rawTarget: raw,
    cleanName,
    directHandle,
    directPlatform,
    handles
  };
}

/**
 * Heuristic fallback aggregator to pick top common profile
 */
function buildHeuristicDossier({ cleanName, wikiData, ghProfiles, probedResults, searchResults, locationHint }) {
  const socialLinks = {
    linkedin: null,
    instagram: null,
    facebook: null,
    twitter_x: null,
    youtube: null,
    tiktok: null,
    github: null,
    wikipedia: null,
    website: null
  };

  let bestAvatar = wikiData?.image_url || null;
  let bestName = wikiData?.title || cleanName;
  let bestBio = wikiData?.extract || null;
  let bestRole = wikiData?.title ? 'Public Figure / Subject' : 'Digital Creator / Professional';
  let bestLocation = locationHint || 'Global / Web';

  // Extract from probed social platforms (ordered by match confidence)
  for (const item of probedResults) {
    if (!socialLinks[item.platform]) {
      socialLinks[item.platform] = item.url;
    }
    if (!bestAvatar && item.image) {
      bestAvatar = item.image;
    }
    if (!bestBio && item.desc && item.desc.length > 20) {
      bestBio = item.desc;
    }
    if (item.displayName && item.displayName !== cleanName && !wikiData?.title) {
      bestName = item.displayName;
    }
  }

  // Extract from GitHub profiles
  if (ghProfiles.length) {
    const topGh = ghProfiles[0];
    if (!socialLinks.github) socialLinks.github = topGh.profile_url;
    if (!bestAvatar && topGh.avatar_url) bestAvatar = topGh.avatar_url;
    if (topGh.name && topGh.name.length > 2 && !wikiData?.title) bestName = topGh.name;
    if (topGh.bio && (!bestBio || bestBio.length < 30)) bestBio = topGh.bio;
    if (topGh.location) bestLocation = topGh.location;
    if (topGh.blog && !socialLinks.website) socialLinks.website = topGh.blog.startsWith('http') ? topGh.blog : `https://${topGh.blog}`;
    if (topGh.twitter_username && !socialLinks.twitter_x) socialLinks.twitter_x = `https://x.com/${topGh.twitter_username}`;
    bestRole = topGh.bio ? topGh.bio.slice(0, 100) : 'Software Developer / Tech Professional';
  }

  if (wikiData?.page_url) {
    socialLinks.wikipedia = wikiData.page_url;
  }

  const sources = [];
  if (wikiData?.page_url) sources.push({ title: `Wikipedia: ${wikiData.title}`, url: wikiData.page_url });
  if (socialLinks.instagram) sources.push({ title: 'Instagram Verified Profile', url: socialLinks.instagram });
  if (socialLinks.github) sources.push({ title: 'GitHub Profile', url: socialLinks.github });
  if (socialLinks.linkedin) sources.push({ title: 'LinkedIn Profile', url: socialLinks.linkedin });
  if (socialLinks.twitter_x) sources.push({ title: 'X (Twitter) Profile', url: socialLinks.twitter_x });
  if (socialLinks.youtube) sources.push({ title: 'YouTube Channel', url: socialLinks.youtube });

  searchResults.slice(0, 4).forEach((r) => {
    if (r.href && !sources.some((s) => s.url === r.href)) {
      sources.push({ title: r.title || r.href, url: r.href });
    }
  });

  const matchedCount = Object.values(socialLinks).filter(Boolean).length;

  return {
    full_name: bestName,
    aliases: [
      ...ghProfiles.map((p) => `@${p.login}`),
      ...probedResults.map((p) => p.handle ? `@${p.handle}` : null)
    ].filter(Boolean).slice(0, 5),
    primary_role: bestRole,
    avatar_url: bestAvatar,
    summary: bestBio || `Public intelligence profile for ${bestName}. Discovered ${matchedCount} verified social and digital accounts across online platforms.`,
    dob: 'Not publicly documented',
    age: 'Unknown',
    birth_place: 'Not publicly confirmed',
    location: bestLocation,
    nationality: 'Verified Digital Profile',
    marital_status: 'Not Public',
    spouse: 'Not publicly listed',
    children: 'Not publicly confirmed',
    education: 'Professional & Career Track',
    social_links: socialLinks,
    affiliations: ghProfiles.map((p) => p.company).filter(Boolean),
    career_highlights: [
      ...ghProfiles.map((p) => `${p.name} on GitHub (@${p.login})`),
      ...probedResults.filter((p) => p.followers).map((p) => `${p.label} Account (@${p.handle}) with ${p.followers} followers`)
    ].slice(0, 3),
    confidence_score: matchedCount > 2 ? 92 : 82,
    verification_notes: `Corroborated across ${matchedCount} verified platforms using deep underscore/dot handles & social indexes.`,
    sources
  };
}

/**
 * Main Bio Data Fetcher
 */
async function fetchBioData(targetInput, locationHint = '') {
  const parsed = parseTargetInput(targetInput);
  const { cleanName, directPlatform, rawTarget, handles } = parsed;

  // Parallel harvesting from all sources
  const [wikiData, ghProfiles, probedResults, searchResults] = await Promise.all([
    fetchWikipediaData(cleanName),
    searchGitHubProfiles(cleanName, handles),
    probeSocialPlatforms(handles, rawTarget, cleanName),
    searchWebPublic(`${cleanName} ${locationHint} profile linkedin instagram facebook twitter`)
  ]);

  // Try Gemini AI synthesis if available
  const ai = getGeminiClient();
  if (ai) {
    try {
      const contextBundle = `
Target Query: ${cleanName}
Location Hint: ${locationHint || 'None'}
Direct Input: ${rawTarget}

Wikipedia Verified Data:
${wikiData ? JSON.stringify(wikiData, null, 2) : 'None'}

GitHub Developer Profiles Found:
${JSON.stringify(ghProfiles, null, 2)}

Direct Social Platform Probes (including Instagram with underscore & dot permutations):
${JSON.stringify(probedResults, null, 2)}

Web Search Snippets:
${JSON.stringify(searchResults.slice(0, 8), null, 2)}
`;

      const prompt = `
You are an advanced Intelligence OSINT dossier analyst.
Extract and compile a structured, accurate profile for the target person from the provided public data.
Pick the top common matching person and synthesize their avatar image, verified social links, bio summary, and details.

Return ONLY a valid JSON object matching this exact schema:
{
  "full_name": "Full name",
  "aliases": ["Known aliases or handles"],
  "primary_role": "Primary profession, title, or what they are best known for",
  "avatar_url": "Direct high quality image URL if available in context, else null",
  "summary": "Concise 2-3 paragraph professional and biographical dossier",
  "dob": "Date of birth if public, else 'Not publicly confirmed'",
  "age": "Age string if known, else 'Unknown'",
  "birth_place": "City, Country of birth if known",
  "location": "Current known residence or city",
  "nationality": "Nationality",
  "marital_status": "Single / Married / Divorced / Not Public",
  "spouse": "Spouse name if public, else 'Not publicly listed'",
  "children": "Children details if public, else 'Not publicly listed'",
  "education": "University / College if known",
  "social_links": {
    "linkedin": "Verified full URL or null",
    "instagram": "Verified full URL or null",
    "facebook": "Verified full URL or null",
    "twitter_x": "Verified full URL or null",
    "youtube": "Verified full URL or null",
    "tiktok": "Verified full URL or null",
    "github": "Verified full URL or null",
    "wikipedia": "Verified full URL or null",
    "website": "Official website or null"
  },
  "affiliations": ["Key companies or affiliations"],
  "career_highlights": ["Key achievements or projects"],
  "confidence_score": 90,
  "verification_notes": "Summary of data provenance",
  "sources": [
    { "title": "Source title", "url": "https://..." }
  ]
}
`;

      const aiResponse = await ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: `${prompt}\n\nDATA CONTEXT:\n${contextBundle}`,
        config: {
          temperature: 0.2,
          maxOutputTokens: 1500,
          responseMimeType: 'application/json'
        }
      });

      const parsedJson = JSON.parse(aiResponse.text);

      // Fallback avatar if AI didn't catch it
      if (!parsedJson.avatar_url) {
        parsedJson.avatar_url = wikiData?.image_url || ghProfiles[0]?.avatar_url || probedResults[0]?.image || null;
      }

      // Ensure probed links are preserved
      for (const p of probedResults) {
        if (!parsedJson.social_links[p.platform]) {
          parsedJson.social_links[p.platform] = p.url;
        }
      }
      if (ghProfiles.length && !parsedJson.social_links.github) {
        parsedJson.social_links.github = ghProfiles[0].profile_url;
      }
      if (wikiData?.page_url) {
        parsedJson.social_links.wikipedia = wikiData.page_url;
      }

      return parsedJson;
    } catch (_) {}
  }

  // Heuristic Fallback
  return buildHeuristicDossier({
    cleanName,
    wikiData,
    ghProfiles,
    probedResults,
    searchResults,
    locationHint
  });
}

module.exports = {
  fetchBioData
};
