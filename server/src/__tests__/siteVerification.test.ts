import { describe, it, expect, afterEach } from 'vitest';
import { googleVerificationTag } from '../lib/siteVerification';
import { metaFor, renderIndexHtml } from '../lib/ogMeta';
import { renderPage } from '../lib/publicSite/render';

// The line Google Search Console asks for: it comes from a setting, appears on the app's home page and on the public pages,
// and is never printed unless it is a plain code.
const CODE = 'abcDEF123_-abcDEF123_-abcDEF123_-abcDEF12345';
const template = '<html lang="en"><head><title>x</title><meta name="description" content="y" /></head><body></body></html>';
afterEach(() => {
  delete process.env.GOOGLE_SITE_VERIFICATION;
});

describe('Google site verification line', () => {
  it('is only a plain code, and nothing when the setting is missing or odd', () => {
    expect(googleVerificationTag({ GOOGLE_SITE_VERIFICATION: CODE })).toBe(`<meta name="google-site-verification" content="${CODE}" />`);
    expect(googleVerificationTag({})).toBe('');
    expect(googleVerificationTag({ GOOGLE_SITE_VERIFICATION: 'short' })).toBe('');
    expect(googleVerificationTag({ GOOGLE_SITE_VERIFICATION: `${CODE}"><script>alert(1)</script>` })).toBe('');
  });

  it('is in the head of the app’s home page and of the public pages when set, and absent when not', () => {
    const app = () => renderIndexHtml(template, { appUrl: 'https://example.org', path: '/', lang: 'both', meta: metaFor('/', 'both') });
    const pub = () => renderPage({ key: 'home', lang: 'en' });
    expect(app()).not.toContain('google-site-verification');
    expect(pub()).not.toContain('google-site-verification');
    process.env.GOOGLE_SITE_VERIFICATION = CODE;
    expect(app()).toContain(`<meta name="google-site-verification" content="${CODE}" />`);
    expect(app().indexOf('google-site-verification')).toBeLessThan(app().indexOf('</head>'));
    expect(pub()).toContain(`content="${CODE}"`);
  });
});
