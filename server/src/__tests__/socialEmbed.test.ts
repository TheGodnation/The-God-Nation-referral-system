import { describe, it, expect } from 'vitest';
import { parseSocialLink, embedSrcFor, embedFor, findFirstUrl, resolveSocialLink } from '../lib/socialEmbed';

// Share-into-app: turning a shared link into a player inside the feed.
describe('Recognising shared links', () => {
  it('finds the link inside shared text', () => {
    expect(findFirstUrl('Watch this! https://vm.tiktok.com/ZMabc123/ amazing.')).toBe('https://vm.tiktok.com/ZMabc123/');
    expect(findFirstUrl('see (https://youtu.be/dQw4w9WgXcQ).')).toBe('https://youtu.be/dQw4w9WgXcQ');
    expect(findFirstUrl('no link here')).toBeNull();
  });

  it('TikTok video → TikTok player', () => {
    const link = parseSocialLink('https://www.tiktok.com/@ministry.page/video/7412345678901234567?is_from_webapp=1&sender_device=pc')!;
    expect(link).toEqual({ provider: 'TIKTOK', url: 'https://www.tiktok.com/@ministry.page/video/7412345678901234567', needsResolve: false });
    expect(embedSrcFor('TIKTOK', link.url)).toBe('https://www.tiktok.com/embed/v2/7412345678901234567');
  });

  it('TikTok short links need the server to look them up', () => {
    expect(parseSocialLink('https://vm.tiktok.com/ZMabc123/')).toMatchObject({ provider: 'TIKTOK', needsResolve: true });
    expect(parseSocialLink('https://www.tiktok.com/t/ZTabc/')).toMatchObject({ provider: 'TIKTOK', needsResolve: true });
    // …and are never put in a player until they have been.
    expect(embedSrcFor('TIKTOK', 'https://vm.tiktok.com/ZMabc123/')).toBeNull();
  });

  it('Instagram post and reel → Instagram player with the caption', () => {
    expect(embedSrcFor('INSTAGRAM', parseSocialLink('https://www.instagram.com/reel/C9xYz_AbC12/?igsh=abc')!.url)).toBe(
      'https://www.instagram.com/reel/C9xYz_AbC12/embed/captioned/',
    );
    expect(parseSocialLink('instagram.com/reels/C9xYz_AbC12')!.url).toBe('https://www.instagram.com/reel/C9xYz_AbC12/');
    expect(parseSocialLink('https://www.instagram.com/p/C1aBcDeFgH/')!.provider).toBe('INSTAGRAM');
  });

  it('Facebook video and post → the right Facebook player, with the post words', () => {
    const video = parseSocialLink('https://m.facebook.com/GodsNation/videos/123456789012345/?mibextid=xyz')!;
    expect(video.url).toBe('https://www.facebook.com/GodsNation/videos/123456789012345/');
    expect(embedSrcFor('FACEBOOK', video.url)).toBe(
      `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(video.url)}&show_text=true&width=500`,
    );
    const post = parseSocialLink('https://web.facebook.com/GodsNation/posts/pfbid02abc')!;
    expect(embedSrcFor('FACEBOOK', post.url)).toContain('/plugins/post.php?href=');
    expect(parseSocialLink('https://fb.watch/abc123/')).toMatchObject({ provider: 'FACEBOOK', needsResolve: true });
    expect(parseSocialLink('https://www.facebook.com/share/v/1AbCdE/')).toMatchObject({ provider: 'FACEBOOK', needsResolve: true });
  });

  it('YouTube → the feed’s usual YouTube player', () => {
    const link = parseSocialLink('https://youtu.be/dQw4w9WgXcQ?si=abc')!;
    expect(link.url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(embedSrcFor('YOUTUBE', link.url)).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0');
  });

  it('any other website stays a plain link — never a player', () => {
    const other = parseSocialLink('https://example.com/watch/123')!;
    expect(other.provider).toBe('OTHER');
    expect(embedFor('OTHER', other.url)).toEqual({ provider: 'OTHER', url: other.url, src: null });
    // A look-alike address can't sneak into a player.
    expect(parseSocialLink('https://tiktok.com.evil.example/@x/video/7412345678901234567')!.provider).toBe('OTHER');
    expect(embedSrcFor('TIKTOK', 'https://evil.example/@x/video/7412345678901234567')).toBeNull();
    expect(parseSocialLink('javascript:alert(1)')).toBeNull();
  });
});

describe('Looking up short links', () => {
  it('follows a TikTok short link to the real video', async () => {
    const fake = async () => ({ url: 'https://www.tiktok.com/@page/video/7400000000000000001?_r=1', status: 200 });
    const link = await resolveSocialLink('https://vm.tiktok.com/ZMabc/', fake);
    expect(link).toEqual({ provider: 'TIKTOK', url: 'https://www.tiktok.com/@page/video/7400000000000000001', needsResolve: false });
  });

  it('a short link that leads somewhere else stays a plain link', async () => {
    const fake = async () => ({ url: 'https://example.com/landing', status: 200 });
    expect((await resolveSocialLink('https://fb.watch/abc/', fake))!.provider).toBe('OTHER');
  });

  it('no internet: stays a plain link, no error', async () => {
    const fake = async () => {
      throw new Error('offline');
    };
    expect((await resolveSocialLink('https://fb.watch/abc/', fake))!.provider).toBe('OTHER');
  });

  it('never goes on the internet for a link that is already complete', async () => {
    let called = false;
    const fake = async () => {
      called = true;
      return { url: '', status: 200 };
    };
    await resolveSocialLink('https://www.instagram.com/p/C1aBcDeFgH/', fake);
    expect(called).toBe(false);
  });
});
