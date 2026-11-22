import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { bootstrap } from './testUtils';
import { isPublicAddress, parseOpenGraph, linkPreview, clearLinkPreviewCache } from '../lib/linkPreview';
import { shareByLink } from '../lib/sharedPosts';

// The card under a link in a chat or a post: our own links come from our database, other links are read safely.
const html = (head: string) => `<!doctype html><html><head>${head}</head><body>hi</body></html>`;
const page = (body: string, init: ResponseInit = {}) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, ...init });
const publicLookup = async () => ['93.184.216.34'];

beforeEach(() => clearLinkPreviewCache());
afterEach(() => vi.restoreAllMocks());

describe('which addresses may be read', () => {
  it('refuses private, loopback, link-local, shared and reserved addresses, and accepts public ones', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.4.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', 'not-an-ip']) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111']) expect(isPublicAddress(ip), ip).toBe(true);
  });
});

describe('reading what a page says about itself', () => {
  it('takes the title, sentence and picture, in either attribute order, and decodes entities', () => {
    const og = parseOpenGraph(html(`<meta property="og:title" content="Fish &amp; Chips"><meta content="A very good meal." property="og:description"><meta property="og:image" content="/img/a.jpg"><meta property="og:site_name" content="Foodie">`), 'https://food.example/menu');
    expect(og).toEqual({ title: 'Fish & Chips', description: 'A very good meal.', image: 'https://food.example/img/a.jpg', site: 'Foodie' });
  });
  it('falls back to the page title, ignores a picture that is not https, and gives nothing when there is no title', () => {
    expect(parseOpenGraph(html('<title> Plain   page </title><meta property="og:image" content="http://x.example/a.jpg">'), 'https://www.plain.example/')).toEqual({ title: 'Plain page', description: '', image: null, site: 'plain.example' });
    expect(parseOpenGraph(html('<meta name="viewport" content="width=device-width">'), 'https://x.example/')).toBeNull();
  });
});

describe('reading a link on the internet', () => {
  it('reads a public page, and remembers the answer', async () => {
    const fetcher = vi.fn(async () => page(html('<meta property="og:title" content="Hello"><meta property="og:description" content="World">'))) as unknown as typeof fetch;
    const first = await linkPreview('https://news.example/a', { lookup: publicLookup, fetcher });
    expect(first).toMatchObject({ title: 'Hello', description: 'World', site: 'news.example' });
    await linkPreview('https://news.example/a', { lookup: publicLookup, fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('never goes to an internal address: not by number, not by name, not through a redirect, not on another port', async () => {
    const fetcher = vi.fn(async () => page(html('<title>secret</title>'))) as unknown as typeof fetch;
    expect(await linkPreview('http://127.0.0.1/admin', { lookup: publicLookup, fetcher })).toBeNull();
    expect(await linkPreview('http://169.254.169.254/latest/meta-data', { lookup: publicLookup, fetcher })).toBeNull();
    expect(await linkPreview('http://localhost/x', { lookup: publicLookup, fetcher })).toBeNull();
    expect(await linkPreview('https://sneaky.example/x', { lookup: async () => ['10.0.0.8'], fetcher })).toBeNull(); // a name that points inside
    expect(await linkPreview('https://example.org:8443/x', { lookup: publicLookup, fetcher })).toBeNull();
    expect(await linkPreview('ftp://example.org/x', { lookup: publicLookup, fetcher })).toBeNull();
    expect(await linkPreview('https://user:pass@example.org/x', { lookup: publicLookup, fetcher })).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    const redirecting = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } })) as unknown as typeof fetch;
    expect(await linkPreview('https://redirect.example/x', { lookup: async (h) => (h === 'redirect.example' ? ['93.184.216.34'] : ['127.0.0.1']), fetcher: redirecting })).toBeNull();
    expect(redirecting).toHaveBeenCalledTimes(1);
  });

  it('gives nothing for a page that is not HTML, or that fails', async () => {
    const pdf = vi.fn(async () => new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf' } })) as unknown as typeof fetch;
    expect(await linkPreview('https://files.example/a.pdf', { lookup: publicLookup, fetcher: pdf })).toBeNull();
    const broken = vi.fn(async () => { throw new Error('timeout'); }) as unknown as typeof fetch;
    expect(await linkPreview('https://down.example/', { lookup: publicLookup, fetcher: broken })).toBeNull();
  });
});

describe('a link to our own pages', () => {
  it('is answered from our database: a shared post gives its title, first lines and picture; a closed link gives nothing', async () => {
    const u = await prisma.user.create({ data: { name: 'Some Admin', email: `lp-${Date.now()}@test.local`, passwordHash: 'x', role: 'ADMIN' } });
    const post = await prisma.headquartersPost.create({ data: { titleEn: 'Good news', titleFr: 'Bonne nouvelle', bodyEn: 'Come and see.', bodyFr: 'Venez voir.', createdByUserId: u.id, publishedAt: new Date() } });
    const base = process.env.APP_URL || 'http://localhost:4000';
    expect(await linkPreview(`${base}/news/post/${post.id}?lang=fr`)).toBeNull(); // not shared yet
    clearLinkPreviewCache();
    await shareByLink('post', post.id);
    const card = await linkPreview(`${base}/news/post/${post.id}?lang=fr`);
    expect(card).toMatchObject({ title: 'Bonne nouvelle', description: 'Venez voir.', site: 'The God Nation' });
    expect(card!.image).toContain('share-card-fr.jpg'); // no picture of its own: the usual card
  });
});

describe('the route', () => {
  const app = createApp();
  it('needs a signed-in member and a link', async () => {
    expect((await request(app).get('/api/member/link-preview?url=https://example.org')).status).toBe(401);
    const person = await prisma.person.create({ data: { name: 'Link Tester', whatsappNumber: `+23778${String(Date.now()).slice(-7)}`, profileCompletedAt: new Date() } });
    const email = `lp${Date.now()}@example.com`;
    await prisma.memberAccount.create({ data: { personId: person.id, email, passwordHash: await bcrypt.hash('GoodPass123!', 4) } });
    const raw = request.agent(app);
    const { csrf } = await bootstrap(raw as any);
    const ip = '10.201.1.1';
    const login = await raw.post('/api/member/auth/login').set('X-Forwarded-For', ip).set('X-CSRF-Token', csrf).send({ email, password: 'GoodPass123!' });
    if (login.body.codeRequired) {
      const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
      await raw.post('/api/member/auth/login').set('X-Forwarded-For', ip).set('X-CSRF-Token', csrf).send({ email, password: 'GoodPass123!' });
      const code = spy.mock.calls[spy.mock.calls.length - 1][0].code as string;
      await raw.post('/api/member/auth/verify-code').set('X-Forwarded-For', ip).set('X-CSRF-Token', csrf).send({ email, code });
    }
    expect((await raw.get('/api/member/link-preview').set('X-Forwarded-For', ip)).status).toBe(400);
    const res = await raw.get('/api/member/link-preview?url=http%3A%2F%2F127.0.0.1%2Fadmin').set('X-Forwarded-For', ip);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ preview: null });
  });
});
