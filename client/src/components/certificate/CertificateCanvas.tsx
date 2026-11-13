import { useEffect, useRef, useState } from 'react';
import { CertificateData, certificateBlob, certificateFileName, drawCertificate, loadCertificateFont, loadTemplate } from '../../lib/certificateRender';

// The diploma as a picture on the screen (and, with `download`, a button to save it as a PNG file).
export function CertificateCanvas({ data, alt, className = '' }: { data: CertificateData; alt: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const { name, number, issuedAt, lang } = data;

  useEffect(() => {
    let alive = true;
    setFailed(false);
    Promise.all([loadTemplate(lang), loadCertificateFont()])
      .then(([img]) => {
        if (alive && ref.current) drawCertificate(ref.current, img, { name, number, issuedAt, lang });
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [name, number, issuedAt, lang]);

  if (failed) return <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{alt}</p>;
  return <canvas ref={ref} role="img" aria-label={alt} className={`h-auto w-full rounded-lg shadow ${className}`} data-testid="certificate-canvas" />;
}

/** Saves the finished certificate as a PNG file on the device. */
export async function downloadCertificate(data: CertificateData): Promise<void> {
  const blob = await certificateBlob(data);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = certificateFileName(data);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
