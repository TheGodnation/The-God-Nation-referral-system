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
  it('gives the home page its title, picture and sentence, in English by default', async () => {
    const res = await request(app()).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('<meta property="og:title" content="The God Nation — Media &amp; Leadership Academy" />');
    expect(res.text).toContain(`<meta property="og:image" content="${APP}/og-image.png" />`);
    expect(res.text).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(res.text).toContain(`<link rel="canonical" href="${APP}" />`);
    expect(res.text).toContain('<html lang="en"');
    expect((res.text.match(/<title>/g) ?? []).length).toBe(1);
    expect((res.text.match(/name="description"/g) ?? []).length).toBe(1);
    // The app itself still loads.
    expect(res.text).toContain('<div id="root"></div>');
  });

  it('uses the join wording for sign-up links, in French when asked, and never copies the referral code into the address', async () => {
    const res = await request(app()).get('/join?ref=MARY7X2&lang=fr');
    expect(res.text).toContain('content="Rejoignez The God Nation"');
    expect(res.text).toContain('<html lang="fr"');
    expect(res.text).toContain('og:locale" content="fr_FR"');
    expect(res.text).toContain(`<link rel="canonical" href="${APP}/join" />`);
    expect(res.text).not.toContain('MARY7X2');
    expect((await request(app()).get('/member/join')).text).toContain('content="Join The God Nation"');
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
