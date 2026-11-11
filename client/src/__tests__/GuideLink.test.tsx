import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GuideLink } from '../components/member/GuideLink';

// Help pages open as a panel over the app (never a new window that could open blank or leave the app).
afterEach(() => {
  Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: undefined });
});

describe('Help page link', () => {
  it('opens the guide in a panel over the app, with a way back and a new-tab fallback', () => {
    render(<GuideLink href="/notifications-guide/">See the steps with pictures</GuideLink>);
    expect(screen.queryByTestId('guide-viewer')).toBeNull();
    const prevented = !fireEvent.click(screen.getByText('See the steps with pictures'));
    expect(prevented).toBe(true);
    expect(screen.getByTestId('guide-viewer')).toBeInTheDocument();
    expect(screen.getByTestId('guide-frame')).toHaveAttribute('src', '/notifications-guide/');
    expect(screen.getByText('Open in a new tab').closest('a')).toHaveAttribute('href', '/notifications-guide/');
    fireEvent.click(screen.getByTestId('guide-close'));
    expect(screen.queryByTestId('guide-viewer')).toBeNull();
  });

  it('works the same inside the installed app, and closes with Escape', () => {
    Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) });
    render(<GuideLink href="/phone-settings-guide/">Need help?</GuideLink>);
    fireEvent.click(screen.getByText('Need help?'));
    expect(screen.getByTestId('guide-frame')).toHaveAttribute('src', '/phone-settings-guide/');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('guide-viewer')).toBeNull();
  });
});
