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

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return resolve(fetchUrl(res.headers.location));
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
  log(`Total duplicates generated: ${duplicates.length}`);

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
