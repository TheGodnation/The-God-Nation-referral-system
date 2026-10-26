import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shrinkPhoto } from '../lib/chatMedia';
import { CROP_SPEC, centrePos, clampPos, coverScale, sourceRect, zoomAboutCentre, type Pos, type Size } from '../lib/imageCrop';

// Facebook-style "adjust your photo": drag the picture behind a fixed frame
// (round for a profile picture, wide for a cover) and zoom with the slider.
// What is inside the frame is what gets saved, at a fixed size, so heads are
// never cut off by surprise. The chosen photo is made smaller first (as the
// chat does) so a big phone picture does not fill the phone's memory.
export function ImageCropper({
  file,
  kind,
  onCancel,
  onDone,
}: {
  file: File;
  kind: 'photo' | 'cover';
  onCancel: () => void;
  /** The cropped picture, ready to upload. */
  onDone: (cropped: File) => void;
}) {
  const { t } = useTranslation();
  const spec = CROP_SPEC[kind];
  const aspect = spec.out.w / spec.out.h;

  const frameRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [nat, setNat] = useState<Size | null>(null);
  const [frame, setFrame] = useState<Size>({ w: 300, h: 300 / aspect });
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState<Pos>({ x: 0, y: 0 });
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const drag = useRef<{ x: number; y: number; pos: Pos } | null>(null);

  // Make the picture smaller first, then show it.
  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    shrinkPhoto(file, 2048)
      .then((blob) => {
        if (!alive) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file]);

  // The frame fills the width of its box.
  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => setFrame({ w: el.clientWidth || 300, h: (el.clientWidth || 300) / aspect });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [aspect]);

  const base = nat ? coverScale(nat, frame) : 1;
  const scale = base * zoom;

  // Start centred once the picture's size is known (and when the frame resizes).
  useEffect(() => {
    if (nat) setPos(centrePos(nat, coverScale(nat, frame) * zoom, frame));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nat, frame.w, frame.h]);

  function onZoom(next: number) {
    if (!nat) return;
    setPos((p) => zoomAboutCentre(p, nat, base * zoom, base * next, frame));
    setZoom(next);
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!nat) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, pos };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || !nat) return;
    setPos(clampPos({ x: d.pos.x + e.clientX - d.x, y: d.pos.y + e.clientY - d.y }, nat, scale, frame));
  }
  function onPointerUp() {
    drag.current = null;
  }

  async function save() {
    const img = imgRef.current;
    if (!img || !nat || saving) return;
    setSaving(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = spec.out.w;
      canvas.height = spec.out.h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas');
      const { sx, sy, sw, sh } = sourceRect(pos, scale, frame);
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, spec.out.w, spec.out.h);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      canvas.width = 0;
      canvas.height = 0;
      if (!blob) throw new Error('blob');
      onDone(new File([blob], `${kind}-${Date.now()}.jpg`, { type: 'image/jpeg' }));
    } catch {
      setFailed(true);
      setSaving(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={t(`cropper.title_${kind}`) ?? ''} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3">
      <div className={`w-full space-y-3 rounded-2xl bg-white p-4 shadow-xl ${kind === 'photo' ? 'max-w-sm' : 'max-w-xl'}`}>
        <h2 className="font-semibold text-slate-900">{t(`cropper.title_${kind}`)}</h2>

        <div
          ref={frameRef}
          data-testid="crop-frame"
          className="relative w-full touch-none select-none overflow-hidden rounded-lg bg-slate-200"
          style={{ height: frame.h }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {src && (
            <img
              ref={imgRef}
              src={src}
              alt=""
              draggable={false}
              onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              onError={() => setFailed(true)}
              className="pointer-events-none absolute left-0 top-0 max-w-none origin-top-left"
              style={nat ? { width: nat.w, height: nat.h, transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})` } : { visibility: 'hidden' }}
            />
          )}
          {spec.round && <div aria-hidden className="pointer-events-none absolute inset-0 rounded-full" style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)' }} />}
        </div>

        <label className="flex items-center gap-3 text-sm text-slate-600">
          <span className="shrink-0">{t('cropper.zoom')}</span>
          <input
            type="range"
            min={1}
            max={4}
            step={0.01}
            value={zoom}
            disabled={!nat}
            onChange={(e) => onZoom(Number(e.target.value))}
            aria-label={t('cropper.zoom') ?? ''}
            className="w-full accent-emerald-600"
          />
        </label>
        <p className="text-xs text-slate-500">{failed ? t('cropper.failed') : t('cropper.hint')}</p>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-full px-4 py-2 text-sm text-slate-600">
            {t('chatActions.cancel')}
          </button>
          <button type="button" onClick={() => void save()} disabled={!nat || saving || failed} className="btn-primary px-5 py-2 disabled:opacity-50">
            {saving ? t('cropper.saving') : t('cropper.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
