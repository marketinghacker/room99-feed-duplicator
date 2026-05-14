#!/usr/bin/env node
// CAPS defense test for generate-feed.js
// RULE: output title MUST always be Title Case, regardless of what's in
// config.json rules (matchInTitle / replaceWith can be ALL CAPS, MiXeD, etc).
//
// This test fails loudly if wordCapitalize() ever stops producing Title Case
// or if it accidentally uppercases the "x" in dimensions like "140x280".
//
// Run: node scripts/test-capitalize.js
// CI: exit code 0 on all pass, 1 on any failure.

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'generate-feed.js'), 'utf8');
const match = src.match(/function wordCapitalize\(s\)\s*\{[\s\S]*?\n\}/);
if (!match) {
  console.error('FAIL: wordCapitalize function not found in generate-feed.js');
  process.exit(1);
}

// Eval the function in isolation (no side effects)
const wordCapitalize = new Function('s', match[0].replace(/^function wordCapitalize\(s\)\s*\{/, '').replace(/\}\s*$/, ''));

const cases = [
  // Input, Expected output, Reason
  ['ZASŁONA NA TARAS', 'Zasłona Na Taras', 'Pure CAPS → Title Case'],
  ['zasłona do altany', 'Zasłona Do Altany', 'Lowercase → Title Case'],
  ['Zasłona Do Pergoli', 'Zasłona Do Pergoli', 'Already Title Case → unchanged'],
  ['GARDEN LINE - ZASŁONA NA TARAS', 'Garden Line - Zasłona Na Taras', 'CAPS with hyphen'],
  ['ZASŁONA 140X280 GARDEN LINE', 'Zasłona 140x280 Garden Line', 'Dimensions: X between digits must stay lowercase'],
  ['Zasłona Mùse - Beżowa 45X45', 'Zasłona Mùse - Beżowa 45x45', 'Polish diacritics + dimensions'],
  ['ZASŁONA WODOODPORNA 100% NA TARAS', 'Zasłona Wodoodporna 100% Na Taras', 'CAPS with % and numbers'],
  ['', '', 'Empty string'],
  ['a', 'A', 'Single letter'],
  ['ZASŁONA NA TARAS 140X280, BEŻOWA', 'Zasłona Na Taras 140x280, Beżowa', 'Comma + dimensions'],
];

let failed = 0;
for (const [input, expected, reason] of cases) {
  const got = wordCapitalize(input);
  const pass = got === expected;
  if (!pass) failed++;
  console.log(`${pass ? 'OK  ' : 'FAIL'} | ${reason}`);
  console.log(`     in:  ${JSON.stringify(input)}`);
  console.log(`     got: ${JSON.stringify(got)}`);
  if (!pass) console.log(`     exp: ${JSON.stringify(expected)}`);
}

// Additional sanity check: every output must have NO 3+ consecutive uppercase letters
// (except dimensions handled by lookbehind on digits)
const allCapsRegex = /[A-ZĄĆĘŁŃÓŚŹŻ]{3,}/;
console.log('\nNo-ALL-CAPS post-condition:');
for (const [input] of cases) {
  if (!input) continue;
  const got = wordCapitalize(input);
  if (allCapsRegex.test(got)) {
    failed++;
    console.log(`FAIL | output contains 3+ consecutive uppercase: ${JSON.stringify(got)}`);
  }
}
if (failed === 0) {
  console.log('OK   | all outputs free of ALL-CAPS sequences');
}

console.log(`\nResult: ${cases.length - failed} pass / ${failed} fail (out of ${cases.length} cases + post-condition)`);
process.exit(failed === 0 ? 0 : 1);
