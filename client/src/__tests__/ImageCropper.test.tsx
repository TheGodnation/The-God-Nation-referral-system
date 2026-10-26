import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImageCropper } from '../components/ImageCropper';

vi.mock('../lib/chatMedia', () => ({ shrinkPhoto: vi.fn(async (f: File) => f) }));

const drawImage = vi.fn();

beforeEach(() => {
  drawImage.mockClear();
  URL.createObjectURL = vi.fn(() => 'blob:picture');
  URL.revokeObjectURL = vi.fn();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
    cb(new Blob(['x'], { type: 'image/jpeg' }));
  } as typeof HTMLCanvasElement.prototype.toBlob;
});
afterEach(() => vi.restoreAllMocks());

const photo = () => new File(['x'], 'me.jpg', { type: 'image/jpeg' });

async function loaded(width: number, height: number) {
  const img = await waitFor(() => {
    const el = document.querySelector('img');
    if (!el) throw new Error('no picture yet');
    return el;
  });
  Object.defineProperty(img, 'naturalWidth', { value: width });
  Object.defineProperty(img, 'naturalHeight', { value: height });
  fireEvent.load(img);
  return img;
}

describe('ImageCropper', () => {
  it('shows the frame, the zoom slider and what to do, and cancels', async () => {
    const onCancel = vi.fn();
    render(<ImageCropper file={photo()} kind="photo" onCancel={onCancel} onDone={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Adjust your profile photo' })).toBeInTheDocument();
    expect(screen.getByTestId('crop-frame')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Zoom' })).toBeInTheDocument();
    expect(screen.getByText(/Drag the photo to move it/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('cannot be saved until the picture is open', async () => {
    render(<ImageCropper file={photo()} kind="cover" onCancel={vi.fn()} onDone={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Adjust your cover photo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('saves the middle of the picture at the fixed profile size (720 x 720)', async () => {
    const onDone = vi.fn();
    render(<ImageCropper file={photo()} kind="photo" onCancel={vi.fn()} onDone={onDone} />);
    await loaded(1200, 600); // wide picture, frame 300 x 300 in this test screen
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    // The picture fills the frame by height, so the visible part is the middle 600 x 600.
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 300, 0, 600, 600, 0, 0, 720, 720);
    const saved = onDone.mock.calls[0][0] as File;
    expect(saved.type).toBe('image/jpeg');
    expect(saved.name).toMatch(/^photo-/);
  });

  it('saves a cover at the wide cover size (1640 x 624)', async () => {
    const onDone = vi.fn();
    render(<ImageCropper file={photo()} kind="cover" onCancel={vi.fn()} onDone={onDone} />);
    await loaded(3280, 1248); // exactly the cover shape: nothing is cut
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const call = drawImage.mock.calls[0];
    expect(call.slice(5)).toEqual([0, 0, 1640, 624]);
    expect(call[3] / call[4]).toBeCloseTo(3280 / 1248, 2);
  });

  it('says so when the picture cannot be opened', async () => {
    render(<ImageCropper file={photo()} kind="photo" onCancel={vi.fn()} onDone={vi.fn()} />);
    const img = await waitFor(() => {
      const el = document.querySelector('img');
      if (!el) throw new Error('no picture yet');
      return el;
    });
    fireEvent.error(img);
    expect(await screen.findByText(/could not be opened/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
