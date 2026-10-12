import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { VoiceInputButton } from '../components/VoiceInputButton';

// A minimal fake of the browser's Web Speech API, good enough to drive
// VoiceInputButton/useSpeechToText through start → result → end. Mirrors
// the real API's `resultIndex`/`isFinal` shape, since continuous mode
// relies on both to pick out only the newly-finalized chunk.
class FakeSpeechRecognition {
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onresult: ((e: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn(() => {
    this.onend?.();
  });
}

let instances: FakeSpeechRecognition[] = [];
function stubRecognition() {
  instances = [];
  (window as any).SpeechRecognition = vi.fn(() => {
    const instance = new FakeSpeechRecognition();
    instances.push(instance);
    return instance;
  });
}
function current() {
  return instances[instances.length - 1];
}

afterEach(() => {
  vi.unstubAllGlobals();
  // @ts-expect-error — test-only cleanup of a global we stub per test.
  delete window.SpeechRecognition;
  // @ts-expect-error — same for the vendor-prefixed name.
  delete window.webkitSpeechRecognition;
  instances = [];
});

describe('VoiceInputButton', () => {
  it('renders nothing when the browser has no Web Speech API', () => {
    const { container } = render(<VoiceInputButton onResult={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('starts listening on click, and delivers each finalized chunk to onResult as it comes in', () => {
    stubRecognition();
    const onResult = vi.fn();
    render(<VoiceInputButton onResult={onResult} />);

    fireEvent.click(screen.getByRole('button', { name: 'Speak to type' }));
    expect(current().start).toHaveBeenCalled();
    expect(current().continuous).toBe(true);
    expect(screen.getByRole('button', { name: 'Stop listening' })).toBeInTheDocument();

    // Only the segment from resultIndex onward is new — interim (non-final)
    // entries before it are ignored.
    current().onresult!({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'Pray for my family' } }] });
    expect(onResult).toHaveBeenCalledWith('Pray for my family');

    current().onresult!({ resultIndex: 1, results: [{ isFinal: true, 0: { transcript: 'first' } }, { isFinal: true, 0: { transcript: 'and for my health' } }] });
    expect(onResult).toHaveBeenLastCalledWith('and for my health');
  });

  it('clicking again while listening stops recognition for good', () => {
    stubRecognition();
    render(<VoiceInputButton onResult={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Speak to type' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop listening' }));
    expect(current().stop).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Speak to type' })).toBeInTheDocument();

    // The browser firing its own onend afterward (a trailing event) must
    // not revive it into a restart loop.
    act(() => current().onend!());
    expect(instances).toHaveLength(1);
  });

  it('keeps dictating across the browser\'s own silence timeout, by starting a fresh recognition instance', () => {
    stubRecognition();
    render(<VoiceInputButton onResult={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Speak to type' }));
    expect(instances).toHaveLength(1);

    // The browser ends the session on its own (a pause in speech) — the
    // button must stay in "listening" state and transparently restart.
    act(() => current().onend!());
    expect(screen.getByRole('button', { name: 'Stop listening' })).toBeInTheDocument();
    expect(instances).toHaveLength(2);
    expect(instances[1].start).toHaveBeenCalled();
  });

  it('retries on a recoverable error (no-speech) instead of giving up', () => {
    stubRecognition();
    render(<VoiceInputButton onResult={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Speak to type' }));

    act(() => {
      current().onerror!({ error: 'no-speech' });
      current().onend!();
    });
    expect(screen.getByRole('button', { name: 'Stop listening' })).toBeInTheDocument();
    expect(instances).toHaveLength(2);
  });

  it('stops for good on a fatal error (permission denied)', () => {
    stubRecognition();
    render(<VoiceInputButton onResult={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Speak to type' }));

    act(() => {
      current().onerror!({ error: 'not-allowed' });
      current().onend!();
    });
    expect(screen.getByRole('button', { name: 'Speak to type' })).toBeInTheDocument();
    expect(instances).toHaveLength(1);
  });
});
