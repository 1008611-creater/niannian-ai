'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const source = fs.readFileSync(path.join(root, 'studio', 'assets', 'studio-browser-entry-removal-r1.js'), 'utf8');
const studioHtml = fs.readFileSync(path.join(root, 'studio', 'index.html'), 'utf8');

assert.match(source, /button\[title="浏览器"\]/);
assert.match(source, /button\[aria-label="打开浏览器"\]/);
assert.match(source, /MutationObserver/);
assert.match(studioHtml, /studio-browser-entry-removal-r1\.js/);

console.log('STUDIO_BROWSER_ENTRY_REMOVED_CONTRACT_OK');
