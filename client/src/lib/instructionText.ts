// An instruction is kept as it was written, with the other-language version beside it: show the reader's own language.
export function pickText(viewerLang: string, language: 'en' | 'fr' | null, original: string, translated: string | null): string {
  const viewer = viewerLang.startsWith('fr') ? 'fr' : 'en';
  if (!language || language === viewer) return original;
  return translated || original;
}
