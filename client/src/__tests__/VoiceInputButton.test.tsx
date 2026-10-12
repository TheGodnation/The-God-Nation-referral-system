import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { VoiceInputButton } from '../components/VoiceInputButton';

// A minimal fake of the browser's Web Speech API, good enough to drive
// VoiceInputButton/useSpeechToText through start → result → end.
class FakeSpeechRecognition {
  lang = '';
  interimResults = false;
  maxAlternatives = 1;
  onresult: ((e: { results: { 0: { transcript: string } }[] }) => void) | null = null;
  onerror: (() => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn(() => {
    this.onend?.();
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  // @ts-expect-error — test-only cleanup of a global we stub per test.
  delete window.SpeechRecognition;
  // @ts-expect-error — same for the vendor-prefixed name.
  delete window.webkitSpeechRecognition;
});

describe('VoiceInputButton', () => {
  it('renders nothing when the browser has no Web Speech API', () => {
    const { container } = render(<VoiceInputButton onResult={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('starts listening on click, and delivers the transcript to onResult', () => {
    let instance: FakeSpeechRecognition | null = null;
    (window as any).SpeechRecognition = vi.fn(() => {
      instance = new FakeSpeechRecognition();
      return instance;
    });
    const onResult = vi.fn();
    render(<VoiceInputButton onResult={onResult} />);

    fireEvent.click(screen.getByRole('button', { name: 'Speak to type' }));
    expect(instance!.start).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Stop listening' })).toBeInTheDocument();

    instance!.onresult!({ results: [{ 0: { transcript: 'Pray for my family' } }] });
    expect(onResult).toHaveBeenCalledWith('Pray for my family');
  });

  it('clicking again while listening stops recognition', () => {
    let instance: FakeSpeechRecognition | null = null;
    (window as any).SpeechRecognition = vi.fn(() => {
      instance = new FakeSpeechRecognition();
      return instance;
    });
    render(<VoiceInputButton onResult={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Speak to type' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop listening' }));
    expect(instance!.stop).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Speak to type' })).toBeInTheDocument();
  });

  it('stops listening (reverts the button) when recognition ends or errors on its own', () => {
    let instance: FakeSpeechRecognition | null = null;
    (window as any).SpeechRecognition = vi.fn(() => {
      instance = new FakeSpeechRecognition();
      return instance;
    });
    render(<VoiceInputButton onResult={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Speak to type' }));
    expect(screen.getByRole('button', { name: 'Stop listening' })).toBeInTheDocument();

    act(() => instance!.onend!());
    expect(screen.getByRole('button', { name: 'Speak to type' })).toBeInTheDocument();
  });
});
