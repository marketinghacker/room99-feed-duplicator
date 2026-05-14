#!/usr/bin/env node
/**
 * Room99 Feed Duplicator
 *
 * Pobiera feed Google PL z publicznego URL FeedOptimise,
 * dodaje duplikaty produktow pasujacych do regul z config.json,
 * zapisuje output TSV do output/google-pl-with-test-titles.tsv.
 *
 * Usage:
 *   node generate-feed.js
 *
 * Cron (co godzine):
 *   0 * * * * cd /path/to/feed-duplicator && /opt/homebrew/bin/node generate-feed.js >> logs/cron.log 2>&1
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = __dirname;
const CONFIG_PATH = path.join(ROOT, 'config.json');

function log(...args) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}]`, ...args);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Retry-aware fetcher. FeedOptimise occasionally returns 429 (rate limit).
// Strategy: 4 attempts with exponential backoff (5s, 20s, 60s, 120s).
// Sends User-Agent so FO can identify us. Non-retryable errors fail fast.
async function fetchUrl(url, attempt = 1) {
  const MAX_ATTEMPTS = 4;
  const BACKOFFS_MS = [5_000, 20_000, 60_000, 120_000]; // index = attempt-1
  return new Promise((resolve, reject) => {
    const opts = new URL(url);
    const reqOpts = {
      hostname: opts.hostname,
      path: opts.pathname + opts.search,
      headers: {
        'User-Agent': 'room99-feed-duplicator/1.1 (+https://github.com/marketinghacker/room99-feed-duplicator)',
        'Accept': 'text/tab-separated-values, text/plain, */*',
      },
    };
    https.get(reqOpts, async (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return resolve(fetchUrl(res.headers.location, attempt));
      }
      if (res.statusCode === 429 || res.statusCode === 503) {
        // Drain socket so it can be reused
        res.resume();
        if (attempt >= MAX_ATTEMPTS) {
          return reject(new Error(`HTTP ${res.statusCode} after ${MAX_ATTEMPTS} attempts: ${url}`));
        }
        const wait = BACKOFFS_MS[attempt - 1];
        const retryAfter = parseInt(res.headers['retry-after'], 10);
        const waitMs = !isNaN(retryAfter) ? Math.max(wait, retryAfter * 1000) : wait;
        log(`[retry] HTTP ${res.statusCode} on attempt ${attempt}/${MAX_ATTEMPTS}, sleeping ${Math.round(waitMs/1000)}s before retry…`);
        await sleep(waitMs);
        try { resolve(await fetchUrl(url, attempt + 1)); } catch (e) { reject(e); }
        return;
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function parseTSV(content) {
  const lines = content.split(/\r?\n/);
  if (lines.length === 0) throw new Error('Empty TSV');

  const headers = lines[0].split('\t');
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = lines[i].split('\t');
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] !== undefined ? values[j] : '';
    }
    rows.push(row);
  }

  return { headers, rows };
}

function buildTSVLine(row, headers) {
  return headers.map(h => {
    const v = row[h] || '';
    return String(v).replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
  }).join('\t');
}

// Word Capitalize — pierwsza litera każdego słowa wielka, reszta mała.
// Zachowuje rozmiary 155x270 (małe x między cyframi), bo używa negative lookbehind:
// litera musi być NIE poprzedzona przez literę ANI cyfrę.
function wordCapitalize(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .replace(/(?<![\p{L}\d])(\p{L})(\p{L}*)/gu, (m, first, rest) => first.toUpperCase() + rest);
}

function generateDuplicate(parent, rule) {
  const dup = { ...parent };
  dup.id = `${parent.id}_${rule.dupSuffix}`;

  const searchRegex = new RegExp(escapeRegExp(rule.searchInTitle), 'i');
  let newTitle = String(parent.title || '').replace(searchRegex, rule.replaceWith);
  // Normalize case (pierwsza litera kazdego slowa wielka) - spojny styl tytulow
  dup.title = wordCapitalize(newTitle);

  return dup;
}

function applyOverrides(row, overrides) {
  for (const [key, value] of Object.entries(overrides)) {
    row[key] = value;
  }
  return row;
}

function generateImageDuplicate(parent, imageRule, parentImages) {
  // Returns a duplicate row with image_link swapped per imageRule.
  // parentImages: { main: <image_link>, additional: [<url>, <url>...] }
  const dup = { ...parent };
  dup.id = `${parent.id}_${imageRule.dupSuffix}`;

  if (imageRule.custom_image_url) {
    dup.image_link = imageRule.custom_image_url;
  } else if (imageRule.promote_to_main_index !== null && imageRule.promote_to_main_index !== undefined) {
    // index 0 = current main (no-op), index >=1 = additional_image_link[index-1]
    const idx = parseInt(imageRule.promote_to_main_index, 10);
    if (idx > 0 && parentImages.additional[idx - 1]) {
      dup.image_link = parentImages.additional[idx - 1];
    }
  }
  return dup;
}

async function main() {
  log('=== Room99 Feed Duplicator START ===');

  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Config not found: ${CONFIG_PATH}`);
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

  const outputPath = path.join(ROOT, config.feedOutputFile);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  // Pobierz feed z publicznego URL FeedOptimise
  log('Fetching feed from:', config.feedSourceUrl);
  const tsvContent = await fetchUrl(config.feedSourceUrl);
  log(`Downloaded ${tsvContent.length} bytes`);

  // Parse
  const { headers, rows: originalRows } = parseTSV(tsvContent);
  log(`Parsed: ${originalRows.length} products, ${headers.length} fields`);
  log('Headers:', headers.slice(0, 10).join(', '), '...');

  // Generate duplicates
  const activeRules = (config.duplicateRules || []).filter(r => r.active);
  log(`Active duplicate rules: ${activeRules.length}`);

  const duplicates = [];
  const matchStats = {};
  const duplicatedProducts = new Set();

  let skippedOutOfStock = 0;
  for (const row of originalRows) {
    const title = row.title || '';
    const availability = (row.availability || '').toLowerCase();

    // Filter: tylko produkty in stock (nie generujemy duplikatow out-of-stock)
    if (availability && availability !== 'in stock' && availability !== 'in_stock') {
      // Sprawdz czy produkt by sie kwalifikowal do duplikacji, ale jest out-of-stock
      const wouldDuplicate = activeRules.some(r => new RegExp(escapeRegExp(r.matchInTitle), 'i').test(title));
      if (wouldDuplicate) skippedOutOfStock++;
      continue;
    }

    for (const rule of activeRules) {
      const matchRegex = new RegExp(escapeRegExp(rule.matchInTitle), 'i');
      if (matchRegex.test(title)) {
        const dup = generateDuplicate(row, rule);
        applyOverrides(dup, config.duplicateFieldOverrides || {});

        if (rule.customLabel1) {
          dup.custom_label_1 = rule.customLabel1;
        }

        // custom_label_8 = kod testu (t1, t2, ...) — Marcin's dedicated test
        // campaign [PLA] Zasłony Garden Line Testy Tytułów (ID 23840838231)
        // ma 5 ad-groupów z inventory filter scoped na custom_label_8 = 'tN'.
        // Bez tego pola duplikaty nie wpadają do tej kampanii (potwierdzone
        // przez ad_group_criterion query agentem D, 2026-05-14).
        dup.custom_label_8 = rule.dupSuffix;

        duplicates.push(dup);
        matchStats[rule.id] = (matchStats[rule.id] || 0) + 1;
        duplicatedProducts.add(row.id);
      }
    }
  }
  if (skippedOutOfStock > 0) {
    log(`Skipped ${skippedOutOfStock} out-of-stock parent matches (no duplicates generated for those)`);
  }

  log('Match stats per rule:');
  for (const [ruleId, count] of Object.entries(matchStats)) {
    log(`  ${ruleId}: ${count} duplicates`);
  }
  log(`Unique parent products duplicated: ${duplicatedProducts.size}`);
  log(`Total title duplicates generated: ${duplicates.length}`);

  // === IMAGE RULES (Sprint 3, gated by feature_flag) ===
  // Each image rule references an existing offerId. We find that product in
  // originalRows, create a duplicate with same fields but with image_link
  // swapped to either an additional_image_link[N] OR a custom_image_url.
  // Same field overrides (gtin/mpn empty, identifier_exists=no, custom_label_2=TITLE_TEST).
  const imageRulesEnabled = !!(config.feature_flags && config.feature_flags.image_rules_enabled);
  const imageRules = Array.isArray(config.imageRules) ? config.imageRules.filter((r) => r.active !== false) : [];

  if (imageRulesEnabled && imageRules.length > 0) {
    log(`Image rules enabled — processing ${imageRules.length} active image rules`);
    let imageDupCount = 0;
    for (const imageRule of imageRules) {
      const parent = originalRows.find((r) => r.id === String(imageRule.offerId));
      if (!parent) {
        log(`  WARN: offerId ${imageRule.offerId} not found in source feed — skipping`);
        continue;
      }
      const additional = (parent.additional_image_link || '').split(',').map((s) => s.trim()).filter(Boolean);
      const dup = generateImageDuplicate(parent, imageRule, { main: parent.image_link || '', additional });
      applyOverrides(dup, config.duplicateFieldOverrides || {});
      if (imageRule.customLabel1) dup.custom_label_1 = imageRule.customLabel1;
      // Always mark image-rule duplicates separately
      dup.custom_label_3 = 'IMAGE_TEST';
      duplicates.push(dup);
      imageDupCount++;
    }
    log(`Image duplicates generated: ${imageDupCount}`);
  } else if (imageRules.length > 0) {
    log(`Image rules present (${imageRules.length}) but feature_flags.image_rules_enabled=false — skipping. Flip flag in config.json to activate.`);
  }

  log(`Total duplicates (title + image) generated: ${duplicates.length}`);

  // Ensure new headers exist
  const newHeaders = [...headers];
  for (const key of Object.keys(config.duplicateFieldOverrides || {})) {
    if (!newHeaders.includes(key)) {
      newHeaders.push(key);
      log(`Added new column: ${key}`);
    }
  }
  if (!newHeaders.includes('custom_label_1')) {
    newHeaders.push('custom_label_1');
  }
  if (!newHeaders.includes('custom_label_8')) {
    newHeaders.push('custom_label_8');
  }

  // Write output - TYLKO duplikaty (nie cały feed; oryginaly idą do GMC z głównego feeda Google PL)
  log('Writing output:', outputPath);
  const outputLines = [
    newHeaders.join('\t'),
    ...duplicates.map(r => buildTSVLine(r, newHeaders))
  ];

  fs.writeFileSync(outputPath, outputLines.join('\n'), 'utf-8');
  log(`OUTPUT: ${duplicates.length} duplikatów (sam plik bez oryginałów - oryginały idą z głównego feeda Google PL w GMC)`);

  // Pokaz pierwsze 3 duplikaty jako sample
  if (duplicates.length > 0) {
    log('Sample duplicates (first 3):');
    duplicates.slice(0, 3).forEach((d, i) => {
      log(`  [${i+1}] id=${d.id}  title="${(d.title || '').slice(0, 80)}..."`);
    });
  }

  log('=== DONE ===');
}

main().catch(e => {
  console.error('FATAL:', e.message);
  console.error(e.stack);
  process.exit(1);
});
