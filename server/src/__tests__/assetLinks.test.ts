import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { assetLinks } from '../lib/assetLinks';

const PRINT = Array.from({ length: 32 }, (_, i) => (i * 7 + 10).toString(16).toUpperCase().padStart(2, '0')).join(':');

describe('Digital Asset Links for the Android app', () => {
  afterEach(() => {
    delete process.env.ANDROID_PACKAGE_NAME;
    delete process.env.ANDROID_SHA256_FINGERPRINTS;
  });

  it('is "not found" (not the app home page) until the package and fingerprint are set', async () => {
    const res = await request(createApp()).get('/.well-known/assetlinks.json');
    expect(res.status).toBe(404);
    expect(res.text).toBe('Not found.');
  });

  it('serves the standard file once both settings are present, with several fingerprints allowed', async () => {
    process.env.ANDROID_PACKAGE_NAME = 'org.thegodnationacademy.app';
    process.env.ANDROID_SHA256_FINGERPRINTS = `${PRINT}, ${PRINT.toLowerCase()}`;
    const res = await request(createApp()).get('/.well-known/assetlinks.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual([
      { relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: 'org.thegodnationacademy.app', sha256_cert_fingerprints: [PRINT, PRINT] } },
    ]);
  });

  it('refuses a malformed package name or fingerprint rather than publishing something wrong', () => {
    expect(assetLinks({ ANDROID_PACKAGE_NAME: 'nodots', ANDROID_SHA256_FINGERPRINTS: PRINT } as never)).toBeNull();
    expect(assetLinks({ ANDROID_PACKAGE_NAME: 'org.x.app', ANDROID_SHA256_FINGERPRINTS: 'AB:CD' } as never)).toBeNull();
    expect(assetLinks({ ANDROID_PACKAGE_NAME: 'org.x.app', ANDROID_SHA256_FINGERPRINTS: '' } as never)).toBeNull();
  });
});
