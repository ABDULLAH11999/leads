require('dotenv').config();

const axios = require('axios');
const cheerio = require('cheerio');

function normalizePhone(phone) {
  if (!phone) return null;

  let normalized = String(phone).replace(/[^\d+]/g, '');

  if (normalized.startsWith('+')) normalized = normalized.slice(1);
  if (normalized.startsWith('0092')) normalized = normalized.slice(2);
  if (normalized.startsWith('03') && normalized.length === 11) {
    normalized = `92${normalized.slice(1)}`;
  }
  if (normalized.startsWith('3') && normalized.length === 10) {
    normalized = `92${normalized}`;
  }

  return /^92\d{10}$/.test(normalized) ? normalized : null;
}

function extractPhone(text) {
  const phonePatterns = [
    /(?:\+92|0092|92|0)?3\d{2}[\s.-]?\d{3}[\s.-]?\d{4}/g,
    /(?:tel:|whatsapp:\/\/send\?phone=)(\+?92\d{10}|03\d{9})/gi
  ];

  for (const pattern of phonePatterns) {
    const matches = text.match(pattern) || [];
    for (const match of matches) {
      const normalized = normalizePhone(match);
      if (normalized) return normalized;
    }
  }

  return null;
}

function extractStoreName($, fallbackDomain) {
  const title = $('meta[property="og:site_name"]').attr('content')
    || $('meta[property="og:title"]').attr('content')
    || $('title').first().text();

  if (title) {
    return title.replace(/\s*[-|].*$/, '').trim();
  }

  return fallbackDomain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('.')[0];
}

function findContactLinks($, baseUrl) {
  const links = new Set();

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    const text = $(element).text().toLowerCase();

    if (!href) return;
    if (/contact|support|whatsapp|about/.test(href.toLowerCase()) || /contact|support|whatsapp/.test(text)) {
      try {
        links.add(new URL(href, baseUrl).toString());
      } catch (_) {
        // Ignore malformed links found in the wild.
      }
    }
  });

  return Array.from(links).slice(0, 3);
}

async function fetchHtml(url) {
  const response = await axios.get(url, {
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; lead-engine/1.0)'
    }
  });

  return response.data;
}

async function scrapeStoreContact(domain) {
  if (!domain) {
    throw new Error('A public store domain or URL is required.');
  }

  const baseUrl = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
  const homeHtml = await fetchHtml(baseUrl);
  const $ = cheerio.load(homeHtml);

  const storeName = extractStoreName($, domain);
  let phone = extractPhone($.root().text() + ' ' + $('a[href]').map((_, el) => $(el).attr('href')).get().join(' '));

  if (!phone) {
    const contactLinks = findContactLinks($, baseUrl);
    for (const link of contactLinks) {
      try {
        const contactHtml = await fetchHtml(link);
        const contact$ = cheerio.load(contactHtml);
        phone = extractPhone(contact$.root().text() + ' ' + contact$('a[href]').map((_, el) => contact$(el).attr('href')).get().join(' '));
        if (phone) break;
      } catch (error) {
        console.warn(`[SCRAPER] Could not fetch contact page ${link}: ${error.message}`);
      }
    }
  }

  return {
    store_name: storeName,
    phone,
    normalized_phone: phone,
    domain: baseUrl
  };
}

if (require.main === module) {
  const domain = process.argv[2];

  scrapeStoreContact(domain)
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error('[SCRAPER] Failed:', error.message);
      process.exitCode = 1;
    });
}

module.exports = {
  extractPhone,
  normalizePhone,
  scrapeStoreContact
};
