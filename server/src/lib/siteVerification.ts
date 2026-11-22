// Google Search Console proves the site is ours with one line in the head of the home page. The code Google gives is kept in the
// GOOGLE_SITE_VERIFICATION setting (never in the repository), and only a plain code (letters, numbers, - and _) is ever printed.
export function googleVerificationTag(env: NodeJS.ProcessEnv = process.env): string {
  const code = (env.GOOGLE_SITE_VERIFICATION ?? '').trim();
  return /^[A-Za-z0-9_-]{20,120}$/.test(code) ? `<meta name="google-site-verification" content="${code}" />` : '';
}
