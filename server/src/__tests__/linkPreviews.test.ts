import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { spaHandler, metaFor, excerpt, renderIndexHtml } from '../lib/ogMeta';

// Link previews: the page sent for a shared link carries its own title,
// picture and sentence (WhatsApp, Facebook and others read these without
// running any scripts).
const template = fs.readFileSync(path.join(__dirname, '../../../client/index.html'), 'utf8');
const APP = 'https://thegodnationacademy.org';

function app() {
  const a = express();
  a.get('*', spaHandler(template, APP, async (slug, lang) =>
    slug === 'our-vision'
      ? lang === 'fr' ? { title: 'Notre vision', text: 'Une <b>vision</b> pour les nations.' } : { title: 'Our vision', text: 'A **vision** for the nations & every tribe.' }
      : null));
  return a;
}

describe('link previews', () => {
  it('gives a link with no language the bilingual card: both languages in the picture and the sentence', async () => {
    const res = await request(app()).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('<meta property="og:title" content="The God Nation — Media &amp; Leadership Academy" />');
    expect(res.text).toContain('og:description" content="Académie des médias et du leadership. Make disciples who make disciples · Faites des disciples qui font des disciples."');
    expect(res.text).toContain(`<meta property="og:image" content="${APP}/share-card.jpg" />`);
    expect(res.text).toContain('<meta property="og:image:type" content="image/jpeg" />');
    expect(res.text).toContain('<meta property="og:locale:alternate" content="fr_FR" />');
    expect(res.text).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(res.text).toContain(`<link rel="canonical" href="${APP}" />`);
    expect(res.text).toContain('<html lang="en"');
    expect((res.text.match(/<title>/g) ?? []).length).toBe(1);
    expect((res.text.match(/name="description"/g) ?? []).length).toBe(1);
    // The app itself still loads.
    expect(res.text).toContain('<div id="root"></div>');
    // And a completely white page can rescue itself (forget the old saved copy, reload once, offer buttons).
    expect(res.text).toContain('white-page-help');
    expect(res.text).toContain('godnation:rescued-at');
    // The rescue never removes the app's background part (that would cut the phone's notifications), and offers no "Fix" button.
    expect(res.text).not.toContain('unregister');
    expect(res.text).not.toContain('Réparer');
  });

  it('a French link gets the all-French card, an English link the all-English card', async () => {
    const fr = await request(app()).get('/member/login?continue=1&lang=fr');
    expect(fr.text).toContain(`<meta property="og:image" content="${APP}/share-card-fr.jpg" />`);
    expect(fr.text).toContain('og:title" content="The God Nation — Académie des médias et du leadership"');
    expect(fr.text).toContain('Allez dans les espaces des médias numériques où des milliards de personnes se rassemblent.');
    expect(fr.text).toContain('<html lang="fr"');
    expect(fr.text).not.toContain('og:locale:alternate');
    const en = await request(app()).get('/member/school?lang=en');
    expect(en.text).toContain(`<meta property="og:image" content="${APP}/share-card-en.jpg" />`);
    expect(en.text).toContain('og:description" content="Go into the digital media spaces where billions gather. Make disciples who make disciples, taking the Gospel of the Kingdom to the ends of the earth."');
    expect(en.text).toContain('<html lang="en"');
    // Each picture really exists in the app's files.
    for (const f of ['share-card.jpg', 'share-card-en.jpg', 'share-card-fr.jpg']) expect(fs.existsSync(path.join(__dirname, '../../../client/public', f)), f).toBe(true);
  });

  it('uses the join wording for sign-up links, in French when asked, and never copies the referral code into the address', async () => {
    const res = await request(app()).get('/join?ref=MARY7X2&lang=fr');
    expect(res.text).toContain('content="Rejoignez The God Nation"');
    expect(res.text).toContain('<html lang="fr"');
    expect(res.text).toContain('og:locale" content="fr_FR"');
    expect(res.text).toContain(`<link rel="canonical" href="${APP}/join" />`);
    expect(res.text).not.toContain('MARY7X2');
    expect((await request(app()).get('/member/join?lang=en')).text).toContain('content="Join The God Nation"');
    expect((await request(app()).get('/member/join')).text).toContain('content="Join The God Nation · Rejoignez The God Nation"');
  });

  it('shows a blog or content page’s own title and an excerpt of its text', async () => {
    const en = await request(app()).get('/page/our-vision');
    expect(en.text).toContain('content="Our vision — The God Nation"');
    expect(en.text).toContain('content="A vision for the nations &amp; every tribe."');
    expect(en.text).toContain('og:type" content="article"');
    expect(en.text).toContain(`href="${APP}/page/our-vision"`);
    const fr = await request(app()).get('/page/our-vision?lang=fr');
    expect(fr.text).toContain('content="Notre vision — The God Nation"');
    expect(fr.text).toContain('content="Une vision pour les nations."');
  });

  it('falls back to the home wording for an unknown page, and leaves the API alone', async () => {
    const res = await request(app()).get('/page/does-not-exist');
    expect(res.text).toContain('og:type" content="website"');
    const api = await request(app()).get('/api/anything');
    expect(api.status).toBe(404);
  });

  it('a shared post’s own picture takes the place of the usual card, and with no picture the usual card stays', async () => {
    const a = express();
    a.get('*', spaHandler(template, APP, async () => null, async (_kind, id) => (id === 'with' ? { title: 'Good news', text: 'Come and see.', image: 'api/shared/post/with/photo/0' } : { title: 'Good news', text: 'Come and see.' })));
    const withPhoto = (await request(a).get('/news/post/with?lang=en')).text;
    expect(withPhoto).toContain('<meta property="og:image" content="https://thegodnationacademy.org/api/shared/post/with/photo/0" />');
    expect(withPhoto).not.toContain('share-card-en.jpg');
    expect(withPhoto).not.toContain('og:image:width'); // a photo can be any size
    const without = (await request(a).get('/news/post/without?lang=en')).text;
    expect(without).toContain('share-card-en.jpg');
    expect(without).toContain('og:image:width');
  });

  it('WhatsApp keeps the usual card when the photo is above its size limit, and the card address carries only lang and v', async () => {
    const a = express();
    a.get('*', spaHandler(template, APP, async () => null, async () => ({ title: 'Good news', text: 'Come and see.', image: 'api/shared/post/p1/photo/0', imageBytes: 900_000 })));
    const whatsapp = (await request(a).get('/news/post/p1?lang=en&v=ab12&ref=SECRETCODE').set('User-Agent', 'WhatsApp/2.23.20 A')).text;
    expect(whatsapp).toContain('share-card-en.jpg'); // 900 KB photo: too big for WhatsApp
    expect(whatsapp).toContain('<meta property="og:url" content="https://thegodnationacademy.org/news/post/p1?lang=en&amp;v=ab12" />');
    expect(whatsapp).not.toContain('SECRETCODE');
    const facebook = (await request(a).get('/news/post/p1?lang=en&v=ab12').set('User-Agent', 'facebookexternalhit/1.1')).text;
    expect(facebook).toContain('/api/shared/post/p1/photo/0');
    expect(facebook).not.toContain('share-card-en.jpg');
  });

  it('escapes quotes and angle brackets in titles', () => {
    const html = renderIndexHtml(template, { appUrl: APP, path: '/x', lang: 'en', meta: { title: 'A "quoted" <b>title</b>', description: 'd', type: 'website' } });
    expect(html).toContain('og:title" content="A &quot;quoted&quot; &lt;b&gt;title&lt;/b&gt;"');
    expect(html).not.toContain('<b>title</b>');
  });

  it('excerpt cuts at a word and adds an ellipsis', () => {
    expect(excerpt('short text')).toBe('short text');
    const long = excerpt('word '.repeat(100), 50);
    expect(long.length).toBeLessThanOrEqual(51);
    expect(long.endsWith('…')).toBe(true);
    expect(metaFor('/', 'en').type).toBe('website');
  });
});
