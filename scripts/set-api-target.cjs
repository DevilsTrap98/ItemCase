// Usage: node scripts/set-api-target.cjs production|local
// Switches which server the packaged desktop app talks to (electron/api-target.json,
// read by electron/main.js). `npm run build` = production; `npm run build:local`
// = localhost, then switches back to production so the committed default stays safe.
const fs = require('fs');
const path = require('path');
const target = process.argv[2];
if (!['production', 'local'].includes(target)) { console.error('usage: set-api-target production|local'); process.exit(1); }
const file = path.join(__dirname, '..', 'electron', 'api-target.json');
const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
cfg.target = target;
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
console.log(`[api-target] desktop app now points to ${target}: ${cfg[target]}`);
