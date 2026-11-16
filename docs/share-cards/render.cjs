// Draws the three link-preview pictures (WhatsApp, Facebook, Telegram…) from cards.html:
//   share-card.jpg     both languages (links without ?lang=)
//   share-card-en.jpg  all English (links with ?lang=en)
//   share-card-fr.jpg  all French  (links with ?lang=fr)
// Run from the repository root:  node docs/share-cards/render.cjs
// Uses the Playwright that is installed on the machine. When the pictures change, give them new file names
// (and update server/src/lib/ogMeta.ts), because WhatsApp keeps showing a picture it has already fetched.
const path = require('path');
const { chromium } = require('playwright');
(async () => {
  const dir = __dirname;
  const out = path.resolve(dir, '../../client/public');
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await p.goto('file://' + path.join(dir, 'cards.html'));
  await p.evaluate(() => document.fonts.ready);
  const files = { E: 'share-card.jpg', EN: 'share-card-en.jpg', FR: 'share-card-fr.jpg' };
  for (const [id, name] of Object.entries(files)) await (await p.$('#' + id)).screenshot({ path: path.join(out, name), type: 'jpeg', quality: 90 });
  await b.close();
})();
