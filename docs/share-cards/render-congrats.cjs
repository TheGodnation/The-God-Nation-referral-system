// Draws the "Congratulations" link-preview picture from congrats.html into client/public/congratulations-card.jpg.
// Run from the repository root:  node docs/share-cards/render-congrats.cjs
const path = require('path');
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await p.goto('file://' + path.join(__dirname, 'congrats.html'));
  await p.evaluate(() => document.fonts.ready);
  await (await p.$('#C')).screenshot({ path: path.resolve(__dirname, '../../client/public/congratulations-card.jpg'), type: 'jpeg', quality: 90 });
  await b.close();
})();
