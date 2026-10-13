import { afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import '../i18n';
import { resetPublicSettingsCacheForTests } from '../lib/usePublicSettings';

// usePublicSettings caches its one real network call at module scope for
// the lifetime of the page (see its own comment) — reset it after every
// test so one test's mocked /api/settings/public response can never leak
// into the next test in the same file.
afterEach(() => {
  resetPublicSettingsCacheForTests();
});
