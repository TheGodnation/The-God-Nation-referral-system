import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { Readable } from 'node:stream';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';
import { DIVISIONS } from '../lib/publicSite/content';
import { renderBody, headingsOf, readingMinutes, slugOf } from '../lib/publicSite/text';
import { resetPublicSiteForTests } from '../lib/publicSite/router';

// Object storage, faked: what was "uploaded" by the browser, and what storage can read back.
const fake = vi.hoisted(() => ({ heads: new Map<string, { contentLength: number; contentType: string }>(), bytes: new Map<string, Buffer>(), deleted: [] as string[] }));
vi.mock('../lib/storage', () => ({
  isStorageConfigured: () => true,
  createUploadUrl: async ({ storageKey }: { storageKey: string }) => ({ url: `https://storage.test/${storageKey}?signed`, expiresAt: new Date(Date.now() + 300000) }),
  headObject: async ({ storageKey }: { storageKey: string }) => fake.heads.get(storageKey) ?? null,
  deleteObject: async ({ storageKey }: { storageKey: string }) => { fake.deleted.push(storageKey); fake.heads.delete(storageKey); fake.bytes.delete(storageKey); },
  getObjectStream: async ({ storageKey }: { storageKey: string }) => (fake.bytes.has(storageKey) ? { body: Readable.from(fake.bytes.get(storageKey)!), contentLength: fake.bytes.get(storageKey)!.length } : null),
}));

// Phase 3 of the Knowledge Centre: articles in the database, the editing tools (central
// admin only), and the rule that nothing reaches a public page until a person has reviewed
// that language version AND published the article.
const RUN = Math.random().toString(36).slice(2, 8);
let appOn: ReturnType<typeof createApp>;
beforeAll(() => {
  process.env.PUBLIC_SITE_ENABLED = 'true';
  appOn = createApp();
  delete process.env.PUBLIC_SITE_ENABLED;
});
beforeEach(() => resetPublicSiteForTests());
afterEach(() => vi.restoreAllMocks());

let n = 0;
function agentWithIp() {
  n += 1;
  const ip = `10.171.${Math.floor(n / 256) % 256}.${n % 256}`;
  const raw = request.agent(appOn);
  const methods = ['get', 'post', 'put', 'delete'] as const;
  const w = {} as Record<(typeof methods)[number], (p: string) => request.Test>;
  for (const m of methods) w[m] = (p: string) => raw[m](p).set('X-Forwarded-For', ip);
  return w;
}
async function admin() {
  const email = `kc-admin-${RUN}-${n}@test.local`;
  await createAdmin(email, 'AdminPass123!');
  const agent = agentWithIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });
  return { agent, csrf, email };
}

const DIV = DIVISIONS[0]; // kingdom-knowledge
const base = '/api/admin/knowledge';
const EN_BODY = 'SECRET-DRAFT-MARKER-EN\n\n## First point\n\nGod is faithful.\n\n## Second point\n\nHe keeps his word.\n\n## Third point\n\nWe trust him.';
const FR_BODY = 'MARQUEUR-FR\n\n## Premier point\n\nDieu est fidèle.';

async function makeArticle(a: { agent: any; csrf: string }, extra: Record<string, unknown> = {}) {
  const res = await a.agent.post(`${base}/articles`).set('X-CSRF-Token', a.csrf).send({ divisionKey: DIV.key, ...extra });
  expect(res.status).toBe(201);
  return res.body.id as string;
}
const putTr = (a: { agent: any; csrf: string }, id: string, lang: 'en' | 'fr', body: Record<string, unknown>) =>
  a.agent.put(`${base}/articles/${id}/translations/${lang}`).set('X-CSRF-Token', a.csrf).send(body);
const review = (a: { agent: any; csrf: string }, id: string, lang: 'en' | 'fr', approved = true) =>
  a.agent.post(`${base}/articles/${id}/translations/${lang}/review`).set('X-CSRF-Token', a.csrf).send({ approved });
const move = (a: { agent: any; csrf: string }, id: string, to: string) =>
  a.agent.post(`${base}/articles/${id}/status`).set('X-CSRF-Token', a.csrf).send({ to });
async function publish(a: { agent: any; csrf: string }, id: string) {
  expect((await move(a, id, 'IN_REVIEW')).status).toBe(200);
  expect((await move(a, id, 'APPROVED')).status).toBe(200);
  return move(a, id, 'PUBLISHED');
}
const enPath = (slug: string) => `/en/knowledge/${DIV.slug.en}/${slug}/`;
const frPath = (slug: string) => `/fr/connaissance/${DIV.slug.fr}/${slug}/`;

describe('Article text', () => {
  it('shows typed HTML as plain characters, never runs it', () => {
    const html = renderBody('Hello <script>alert(1)</script> <img src=x onerror=alert(1)>\n\n<b>bold?</b>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('only allows web addresses and addresses on this site as links', () => {
    const html = renderBody('[ok](https://example.org/a) [here](/en/about/) [bad](javascript:alert(1)) [data](data:text/html;base64,AAA)');
    expect(html).toContain('href="https://example.org/a"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('href="/en/about/"');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('data:text');
  });

  it('makes headings with anchors, lists, quotes and emphasis, and counts reading time', () => {
    const src = '## Faith in action\n\ntext with **strong** and *soft*\n\n- one\n- two\n\n1. first\n2. second\n\n> A quote\n> — John 3:16';
    const html = renderBody(src);
    expect(html).toContain('<h2 id="faith-in-action">Faith in action</h2>');
    expect(html).toContain('<strong>strong</strong>');
    expect(html).toContain('<em>soft</em>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<blockquote>');
    expect(headingsOf(src)).toEqual([{ id: 'faith-in-action', text: 'Faith in action' }]);
    expect(readingMinutes('word '.repeat(450))).toBe(3);
    expect(readingMinutes('')).toBe(1);
    expect(slugOf('Café — La Foi!')).toBe('cafe-la-foi');
  });
});

describe('Who may edit', () => {
  it('is for the central admin only', async () => {
    const anon = agentWithIp();
    expect((await anon.get(base)).status).toBe(401);
    expect((await anon.post(`${base}/articles`).send({ divisionKey: DIV.key })).status).toBe(401);
    expect((await anon.get('/api/member/central-knowledge')).status).toBe(401);
  });

  it('keeps an ordinary member out of the member copy', async () => {
    n += 1;
    const person = await prisma.person.create({ data: { name: `Marie ${RUN}`, whatsappNumber: `+2376590${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
    const email = `kc-member-${RUN}-${n}@example.com`;
    await prisma.memberAccount.create({ data: { personId: person.id, email, passwordHash: await bcrypt.hash('GoodPass123!', 4) } });
    const agent = agentWithIp();
    const { csrf } = await bootstrap(agent as any);
    await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'GoodPass123!' });
    expect((await agent.get('/api/member/central-knowledge')).status).toBe(403);
    expect((await agent.post('/api/member/central-knowledge/articles').set('X-CSRF-Token', csrf).send({ divisionKey: DIV.key })).status).toBe(403);
  });

  it('refuses changes without the protection token', async () => {
    const a = await admin();
    expect((await a.agent.post(`${base}/articles`).send({ divisionKey: DIV.key })).status).toBe(403);
  });
});

describe('Writing, reviewing and publishing', () => {
  it('nothing is public until a person has reviewed a version and published the article', async () => {
    const a = await admin();
    const slug = `faith-${RUN}`;
    const id = await makeArticle(a);
    const saved = await putTr(a, id, 'en', { title: 'God is faithful', summary: 'A short summary.', body: EN_BODY, slug });
    expect(saved.status).toBe(200);
    expect(saved.body.readingMinutes).toBe(1);

    // A draft is not public.
    expect((await request(appOn).get(enPath(slug))).status).toBe(404);

    // Publishing needs a reviewed version (and a valid move).
    expect((await move(a, id, 'PUBLISHED')).status).toBe(409);
    expect((await move(a, id, 'IN_REVIEW')).status).toBe(200);
    expect((await move(a, id, 'APPROVED')).status).toBe(200);
    const early = await move(a, id, 'PUBLISHED');
    expect(early.status).toBe(409);
    expect(early.body.error).toMatch(/reviewed/i);
    expect((await request(appOn).get(enPath(slug))).status).toBe(404);

    // Review, publish: now public. The page is complete HTML, without cookies.
    expect((await review(a, id, 'en')).status).toBe(200);
    expect((await move(a, id, 'PUBLISHED')).status).toBe(200);
    const page = await request(appOn).get(enPath(slug));
    expect(page.status).toBe(200);
    expect(page.headers['set-cookie']).toBeUndefined();
    expect(page.headers['content-language']).toBe('en');
    expect(page.text).toContain('<h1>God is faithful</h1>');
    expect(page.text).toContain('God is faithful');
    expect(page.text).toContain('<h2 id="first-point">First point</h2>');
    expect(page.text).toContain(`<link rel="canonical" href="`);
    expect(page.text).not.toContain('<script>alert');
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(page.text)![1]) as { '@type': string }[];
    expect(ld.map((x) => x['@type'])).toEqual(expect.arrayContaining(['Article', 'BreadcrumbList']));
    // No French version: no language switch, no hreflang pair, and the French address does not exist.
    expect(page.text).not.toContain('hreflang="fr"');
    expect((await request(appOn).get(frPath(slug))).status).toBe(404);

    // The sitemap and the area page list it; the Knowledge Centre page too.
    const sm = await request(appOn).get('/sitemap-public.xml');
    expect(sm.text).toContain(enPath(slug));
    const area = await request(appOn).get(`/en/knowledge/${DIV.slug.en}/`);
    expect(area.text).toContain('God is faithful');
    expect(area.text).not.toContain('noindex');
    expect((await request(appOn).get('/en/knowledge/')).text).toContain('God is faithful');
    expect((await request(appOn).get('/en/')).text).toContain('God is faithful');
  });

  it('an unreviewed French version stays invisible; once reviewed the pair is linked both ways', async () => {
    const a = await admin();
    const en = `trust-${RUN}`;
    const fr = `confiance-${RUN}`;
    const id = await makeArticle(a);
    await putTr(a, id, 'en', { title: 'Trust', summary: 'About trust.', body: EN_BODY, slug: en });
    await review(a, id, 'en');
    await publish(a, id);
    await putTr(a, id, 'fr', { title: 'Confiance', summary: 'Sur la confiance.', body: FR_BODY, slug: fr });

    expect((await request(appOn).get(frPath(fr))).status).toBe(404);
    const enPage = await request(appOn).get(enPath(en));
    expect(enPage.text).not.toContain('MARQUEUR-FR');
    expect(enPage.text).not.toContain('hreflang="fr"');
    expect((await request(appOn).get('/sitemap-public.xml')).text).not.toContain(fr);

    await review(a, id, 'fr');
    const frPage = await request(appOn).get(frPath(fr));
    expect(frPage.status).toBe(200);
    expect(frPage.text).toContain('<html lang="fr">');
    expect(frPage.text).toContain(`hreflang="en" href="http`);
    const enAfter = await request(appOn).get(enPath(en));
    expect(enAfter.text).toContain('hreflang="fr"');
    const sm = (await request(appOn).get('/sitemap-public.xml')).text;
    expect(sm).toContain(frPath(fr));
    expect(sm).toContain(enPath(en));
  });

  it('changing words takes a reviewed version back to "not reviewed", so it leaves the public site until re-checked', async () => {
    const a = await admin();
    const slug = `edit-${RUN}`;
    const id = await makeArticle(a);
    await putTr(a, id, 'en', { title: 'Edit me', summary: 'S.', body: EN_BODY, slug });
    await review(a, id, 'en');
    await publish(a, id);
    expect((await request(appOn).get(enPath(slug))).status).toBe(200);

    const changed = await putTr(a, id, 'en', { title: 'Edit me', summary: 'S.', body: `${EN_BODY}\n\nA new sentence.`, slug });
    expect(changed.body.reviewReset).toBe(true);
    expect((await request(appOn).get(enPath(slug))).status).toBe(404);

    await review(a, id, 'en');
    const back = await request(appOn).get(enPath(slug));
    expect(back.status).toBe(200);
    expect(back.text).toContain('A new sentence.');
  });

  it('withdrawing an article removes it from every public place at once', async () => {
    const a = await admin();
    const slug = `gone-${RUN}`;
    const id = await makeArticle(a);
    await putTr(a, id, 'en', { title: 'Short lived', summary: 'S.', body: EN_BODY, slug });
    await review(a, id, 'en');
    await publish(a, id);
    expect((await request(appOn).get('/sitemap-public.xml')).text).toContain(slug);
    expect((await move(a, id, 'UNPUBLISHED')).status).toBe(200);
    expect((await request(appOn).get(enPath(slug))).status).toBe(404);
    expect((await request(appOn).get('/sitemap-public.xml')).text).not.toContain(slug);
    expect((await request(appOn).get(`/en/knowledge/${DIV.slug.en}/`)).text).not.toContain('Short lived');
  });

  it('typed scripts in an article never run on the page', async () => {
    const a = await admin();
    const slug = `xss-${RUN}`;
    const id = await makeArticle(a);
    await putTr(a, id, 'en', { title: 'Plain <b>title</b>', summary: 'S <script>x</script>', body: 'Hi <script>alert(1)</script>\n\n[x](javascript:alert(1))', slug, faq: [{ q: '<i>Q</i>', a: '<script>A</script>' }] });
    await review(a, id, 'en');
    await publish(a, id);
    const page = await request(appOn).get(enPath(slug));
    expect(page.status).toBe(200);
    const withoutLd = page.text.replace(/<script type="application\/ld\+json">.*?<\/script>/s, '');
    expect(withoutLd).not.toContain('<script');
    expect(withoutLd).not.toContain('javascript:');
    expect(withoutLd).not.toContain('<b>title');
  });

  it('a picture needs a description; the description is required for each public language', async () => {
    const a = await admin();
    const bad = await a.agent.post(`${base}/articles`).set('X-CSRF-Token', a.csrf).send({ divisionKey: DIV.key, featuredImageUrl: 'https://example.org/p.jpg' });
    expect(bad.status).toBe(400);
    const unsafe = await a.agent.post(`${base}/articles`).set('X-CSRF-Token', a.csrf).send({ divisionKey: DIV.key, featuredImageUrl: 'javascript:alert(1)', featuredImageAltEn: 'x' });
    expect(unsafe.status).toBe(400);

    const slug = `pic-${RUN}`;
    const id = await makeArticle(a, { featuredImageUrl: 'https://example.org/p.jpg', featuredImageAltEn: 'A pastor teaching' });
    await putTr(a, id, 'en', { title: 'With picture', summary: 'S.', body: EN_BODY, slug });
    await putTr(a, id, 'fr', { title: 'Avec image', summary: 'R.', body: FR_BODY, slug: `${slug}-fr` });
    await review(a, id, 'en');
    await review(a, id, 'fr');
    await move(a, id, 'IN_REVIEW'); await move(a, id, 'APPROVED');
    const blocked = await move(a, id, 'PUBLISHED');
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toContain('fr');
    const fixed = await a.agent.put(`${base}/articles/${id}`).set('X-CSRF-Token', a.csrf).send({ featuredImageAltFr: 'Un pasteur enseigne' });
    expect(fixed.status).toBe(200);
    expect((await move(a, id, 'PUBLISHED')).status).toBe(200);
    const page = await request(appOn).get(enPath(slug));
    expect(page.text).toContain('<img class="hero-img" src="https://example.org/p.jpg" alt="A pastor teaching"');
  });

  it('keeps authors and related articles; deleting an author keeps the article', async () => {
    const a = await admin();
    const au = await a.agent.post(`${base}/authors`).set('X-CSRF-Token', a.csrf).send({ name: 'Evangelist Test', bioEn: 'A servant of God.' });
    expect(au.status).toBe(201);
    const s1 = `rel-a-${RUN}`;
    const s2 = `rel-b-${RUN}`;
    const id1 = await makeArticle(a, { authorId: au.body.id });
    const id2 = await makeArticle(a);
    await putTr(a, id1, 'en', { title: 'Article one', summary: 'S1.', body: EN_BODY, slug: s1 });
    await putTr(a, id2, 'en', { title: 'Article two', summary: 'S2.', body: EN_BODY, slug: s2 });
    for (const id of [id1, id2]) { await review(a, id, 'en'); await publish(a, id); }
    expect((await a.agent.put(`${base}/articles/${id1}`).set('X-CSRF-Token', a.csrf).send({ relatedIds: [id1] })).status).toBe(400);
    expect((await a.agent.put(`${base}/articles/${id1}`).set('X-CSRF-Token', a.csrf).send({ relatedIds: [id2] })).status).toBe(200);
    const page = await request(appOn).get(enPath(s1));
    expect(page.text).toContain('Evangelist Test');
    expect(page.text).toContain('A servant of God.');
    expect(page.text).toContain('Article two');

    expect((await a.agent.delete(`${base}/authors/${au.body.id}`).set('X-CSRF-Token', a.csrf)).status).toBe(200);
    const after = await request(appOn).get(enPath(s1));
    expect(after.status).toBe(200);
    expect(after.text).not.toContain('Evangelist Test');
  });

  it('refuses bad input: unknown area, odd slug, repeated slug, impossible moves, deleting a live article', async () => {
    const a = await admin();
    expect((await a.agent.post(`${base}/articles`).set('X-CSRF-Token', a.csrf).send({ divisionKey: 'nope' })).status).toBe(400);
    const id = await makeArticle(a);
    expect((await putTr(a, id, 'en', { title: 'T', summary: 'S', body: 'b', slug: 'Bad Slug!' })).status).toBe(400);
    expect((await putTr(a, id, 'de' as any, { title: 'T', summary: 'S', body: 'b' })).status).toBe(400);
    const slug = `dup-${RUN}`;
    expect((await putTr(a, id, 'en', { title: 'T', summary: 'S', body: 'b', slug })).status).toBe(200);
    const id2 = await makeArticle(a);
    expect((await putTr(a, id2, 'en', { title: 'T2', summary: 'S', body: 'b', slug })).status).toBe(409);
    expect((await move(a, id, 'UNPUBLISHED')).status).toBe(409);
    expect((await review(a, id2, 'fr')).status).toBe(404);
    await review(a, id, 'en');
    await publish(a, id);
    expect((await a.agent.delete(`${base}/articles/${id}`).set('X-CSRF-Token', a.csrf)).status).toBe(409);
    expect((await a.agent.delete(`${base}/articles/${id2}`).set('X-CSRF-Token', a.csrf)).status).toBe(200);
  });

  it('writes every important action to the audit trail', async () => {
    const a = await admin();
    const id = await makeArticle(a);
    await putTr(a, id, 'en', { title: 'Audited', summary: 'S.', body: 'b', slug: `aud-${RUN}` });
    await review(a, id, 'en');
    await publish(a, id);
    const actions = (await prisma.auditLog.findMany({ where: { targetId: id } })).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['KNOWLEDGE_ARTICLE_CREATED', 'KNOWLEDGE_TRANSLATION_SAVED', 'KNOWLEDGE_TRANSLATION_APPROVED', 'KNOWLEDGE_ARTICLE_PUBLISHED']));
    const list = await a.agent.get(base);
    expect(list.status).toBe(200);
    const row = list.body.articles.find((x: { id: string }) => x.id === id);
    expect(row.status).toBe('PUBLISHED');
    // The list does not carry the long text.
    expect(JSON.stringify(row)).not.toContain('"body"');
  });
});

describe('The editing screen needs', () => {
  it('a safe preview of the text, the public address of each version, and the areas with their address words', async () => {
    const a = await admin();
    const prev = await a.agent.post(`${base}/preview`).set('X-CSRF-Token', a.csrf).send({ body: '## Hello\n\n<script>alert(1)</script> and **bold**' });
    expect(prev.status).toBe(200);
    expect(prev.body.html).toContain('<h2 id="hello">Hello</h2>');
    expect(prev.body.html).not.toContain('<script');
    expect(prev.body.html).toContain('<strong>bold</strong>');
    expect(prev.body.readingMinutes).toBe(1);
    expect((await a.agent.post(`${base}/preview`).send({ body: 'x' })).status).toBe(403);
    expect((await agentWithIp().post(`${base}/preview`).send({ body: 'x' })).status).toBe(401);

    const slug = `edit-screen-${RUN}`;
    const id = await makeArticle(a);
    await putTr(a, id, 'en', { title: 'Screen', summary: 'S.', body: 'b', slug });
    const draft = await a.agent.get(`${base}/articles/${id}`);
    expect(draft.body.translations[0]).toMatchObject({ lang: 'en', publicPath: enPath(slug), isPublic: false });
    await review(a, id, 'en');
    await publish(a, id);
    const live = await a.agent.get(`${base}/articles/${id}`);
    expect(live.body.translations[0].isPublic).toBe(true);
    const list = await a.agent.get(base);
    expect(list.body.divisions).toHaveLength(6);
    expect(list.body.divisions[0].slug).toEqual({ en: DIV.slug.en, fr: DIV.slug.fr });
  });
});

describe('Pictures', () => {
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);
  async function upload(a: { agent: any; csrf: string }, extra: Record<string, unknown> = {}) {
    const auth = await a.agent.post(`${base}/media/authorize`).set('X-CSRF-Token', a.csrf).send({ mimeType: 'image/jpeg', byteSize: JPEG.length });
    expect(auth.status).toBe(200);
    // The browser sends the file straight to storage ...
    const key = `knowledge/${auth.body.id}.jpg`;
    fake.heads.set(key, { contentLength: JPEG.length, contentType: 'image/jpeg' });
    fake.bytes.set(key, JPEG);
    // ... then tells the app it is there.
    const fin = await a.agent.post(`${base}/media/${auth.body.id}/finalize`).set('X-CSRF-Token', a.csrf).send({ mimeType: 'image/jpeg', width: 1200, height: 800, altEn: 'A pastor teaching', altFr: 'Un pasteur enseigne', ...extra });
    return { auth: auth.body, fin, key };
  }

  it('is for the central admin only, needs the protection token, and accepts only small JPEG, PNG or WebP pictures', async () => {
    const a = await admin();
    expect((await agentWithIp().post(`${base}/media/authorize`).send({ mimeType: 'image/jpeg', byteSize: 1000 })).status).toBe(401);
    expect((await a.agent.post(`${base}/media/authorize`).send({ mimeType: 'image/jpeg', byteSize: 1000 })).status).toBe(403);
    for (const bad of [{ mimeType: 'image/svg+xml', byteSize: 1000 }, { mimeType: 'image/gif', byteSize: 1000 }, { mimeType: 'text/html', byteSize: 1000 }, { mimeType: 'image/jpeg', byteSize: 9_000_000 }, { mimeType: 'image/jpeg', byteSize: 0 }]) {
      expect((await a.agent.post(`${base}/media/authorize`).set('X-CSRF-Token', a.csrf).send(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    const ok = await a.agent.post(`${base}/media/authorize`).set('X-CSRF-Token', a.csrf).send({ mimeType: 'image/png', byteSize: 50_000 });
    expect(ok.status).toBe(200);
    expect(ok.body.uploadUrl).toContain(`knowledge/${ok.body.id}.png`);
    expect(ok.body.publicUrl).toBe(`/media/k/${ok.body.id}.png`);
  });

  it('registers a picture only once it really arrived, and not twice', async () => {
    const a = await admin();
    const auth = await a.agent.post(`${base}/media/authorize`).set('X-CSRF-Token', a.csrf).send({ mimeType: 'image/jpeg', byteSize: 1000 });
    const missing = await a.agent.post(`${base}/media/${auth.body.id}/finalize`).set('X-CSRF-Token', a.csrf).send({ mimeType: 'image/jpeg', width: 100, height: 100 });
    expect(missing.status).toBe(404);
    expect((await prisma.knowledgeMedia.count({ where: { id: auth.body.id } }))).toBe(0);

    const { fin, auth: first } = await upload(a);
    expect(fin.status).toBe(201);
    expect(fin.body).toMatchObject({ url: `/media/k/${first.id}.jpg`, width: 1200, height: 800, altEn: 'A pastor teaching' });
    const again = await a.agent.post(`${base}/media/${first.id}/finalize`).set('X-CSRF-Token', a.csrf).send({ mimeType: 'image/jpeg', width: 1200, height: 800 });
    expect(again.status).toBe(200);
    expect(await prisma.knowledgeMedia.count({ where: { id: first.id } })).toBe(1);
  });

  it('refuses and removes a file that is bigger than announced', async () => {
    const a = await admin();
    const auth = await a.agent.post(`${base}/media/authorize`).set('X-CSRF-Token', a.csrf).send({ mimeType: 'image/jpeg', byteSize: 1000 });
    const key = `knowledge/${auth.body.id}.jpg`;
    fake.heads.set(key, { contentLength: 5_000_000, contentType: 'image/jpeg' });
    const fin = await a.agent.post(`${base}/media/${auth.body.id}/finalize`).set('X-CSRF-Token', a.csrf).send({ mimeType: 'image/jpeg', width: 100, height: 100 });
    expect(fin.status).toBe(400);
    expect(fake.deleted).toContain(key);
    expect(await prisma.knowledgeMedia.count({ where: { id: auth.body.id } })).toBe(0);
  });

  it('lists pictures, shows which an article uses, and refuses to delete one that is in use', async () => {
    const a = await admin();
    const { auth } = await upload(a);
    const url = `/media/k/${auth.id}.jpg`;
    const list1 = await a.agent.get(`${base}/media`);
    expect(list1.body.items.find((m: { id: string }) => m.id === auth.id)).toMatchObject({ url, inUse: false });

    const id = await makeArticle(a, { featuredImageUrl: url, featuredImageAltEn: 'A pastor teaching' });
    expect((await a.agent.get(`${base}/media`)).body.items.find((m: { id: string }) => m.id === auth.id).inUse).toBe(true);
    const refused = await a.agent.delete(`${base}/media/${auth.id}`).set('X-CSRF-Token', a.csrf);
    expect(refused.status).toBe(409);

    await a.agent.put(`${base}/articles/${id}`).set('X-CSRF-Token', a.csrf).send({ featuredImageUrl: null });
    const del = await a.agent.delete(`${base}/media/${auth.id}`).set('X-CSRF-Token', a.csrf);
    expect(del.status).toBe(200);
    expect(fake.deleted).toContain(`knowledge/${auth.id}.jpg`);
    expect(await prisma.knowledgeMedia.count({ where: { id: auth.id } })).toBe(0);
  });

  it('the public website serves a registered picture with a long cache and no cookies, and nothing else', async () => {
    const a = await admin();
    const { auth } = await upload(a);
    const res = await request(appOn).get(`/media/k/${auth.id}.jpg`).buffer(true).parse((r, cb) => { const chunks: Buffer[] = []; r.on('data', (c: Buffer) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))); });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['cache-control']).toContain('immutable');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(Buffer.compare(res.body as Buffer, JPEG)).toBe(0);
    // Wrong kind in the address, an unknown id, and a made-up key are all just "not found".
    expect((await request(appOn).get(`/media/k/${auth.id}.png`)).status).toBe(404);
    expect((await request(appOn).get('/media/k/00000000-0000-0000-0000-000000000000.jpg')).status).toBe(404);
    expect((await request(appOn).get('/media/k/..%2f..%2fetc.jpg')).status).not.toBe(200);
  });

  it('an article page shows its picture with the reserved size and the description in each language', async () => {
    const a = await admin();
    const { auth } = await upload(a);
    const slug = `pic-up-${RUN}`;
    const id = await makeArticle(a, { featuredImageUrl: `/media/k/${auth.id}.jpg`, featuredImageAltEn: 'A pastor teaching', featuredImageAltFr: 'Un pasteur enseigne' });
    await putTr(a, id, 'en', { title: 'With uploaded picture', summary: 'S.', body: EN_BODY, slug });
    await review(a, id, 'en');
    await publish(a, id);
    const page = await request(appOn).get(enPath(slug));
    expect(page.status).toBe(200);
    expect(page.text).toContain(`src="/media/k/${auth.id}.jpg" width="1200" height="800" alt="A pastor teaching"`);
    expect(page.text).toContain(`<meta property="og:image" content="`);
    expect(page.text).toContain(`/media/k/${auth.id}.jpg"`);
  });
});

describe('When the database is away', () => {
  it('keeps serving the last good pages; with none yet, answers "try again" (503), never a false not-found', async () => {
    const a = await admin();
    const slug = `away-${RUN}`;
    const id = await makeArticle(a);
    await putTr(a, id, 'en', { title: 'Still there', summary: 'S.', body: EN_BODY, slug });
    await review(a, id, 'en');
    await publish(a, id);
    expect((await request(appOn).get(enPath(slug))).status).toBe(200);

    // (Swapped by hand: restoring a spy on a Prisma delegate removes the method.)
    const delegate = prisma.knowledgeArticle as unknown as { findMany: unknown };
    const original = delegate.findMany;
    delegate.findMany = vi.fn().mockRejectedValue(new Error('Connection closed'));
    // An editor-triggered refresh fails: the old copy is still served.
    await putTr(a, id, 'en', { title: 'Still there', summary: 'S.', body: EN_BODY, slug }).catch(() => undefined);
    const stillThere = await request(appOn).get('/en/knowledge/');
    expect(stillThere.status).toBe(200);

    // No copy at all: a clear, uncacheable "try again" page.
    resetPublicSiteForTests();
    const down = await request(appOn).get('/en/about/');
    expect(down.status).toBe(503);
    expect(down.headers['retry-after']).toBeDefined();
    expect(down.headers['cache-control']).toBe('no-store');
    expect((await request(appOn).get('/fr/a-propos/')).text).toContain('réessayer');
    expect((await request(appOn).get('/sitemap-public.xml')).status).toBe(503);
    delegate.findMany = original;
    expect((await request(appOn).get('/en/about/')).status).toBe(200);
  });
});
