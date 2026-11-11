import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GuideLink } from '../components/member/GuideLink';

// Help pages open in a new tab in a browser, but in the same window inside the installed app (a new window can
// open blank there).
afterEach(() => {
  Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: undefined });
  vi.unstubAllGlobals();
});

describe('Help page link', () => {
  it('opens a new tab in a normal browser', () => {
    render(<GuideLink href="/notifications-guide/">Need help?</GuideLink>);
    const a = screen.getByText('Need help?');
    expect(a).toHaveAttribute('target', '_blank');
    const prevented = !fireEvent.click(a);
    expect(prevented).toBe(false);
  });

  it('opens in the same window inside the installed app', () => {
    Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) });
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    render(<GuideLink href="/notifications-guide/">Need help?</GuideLink>);
    const prevented = !fireEvent.click(screen.getByText('Need help?'));
    expect(prevented).toBe(true);
    expect(assign).toHaveBeenCalledWith('/notifications-guide/');
  });
});
