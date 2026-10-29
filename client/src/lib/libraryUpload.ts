// Sends a book's PDF straight to storage, reporting how much has gone up (so a
// big book on a slow connection visibly moves), and says why when it fails.

export interface PutResult {
  ok: boolean;
  /** HTTP status from storage; 0 when the request never got an answer (connection dropped, blocked). */
  status: number;
}

export function putPdf(url: string, file: Blob, onProgress: (fraction: number) => void): Promise<PutResult> {
  return new Promise((resolve) => {
    if (typeof XMLHttpRequest === 'undefined') {
      fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: file })
        .then((r) => resolve({ ok: r.ok, status: r.status }))
        .catch(() => resolve({ ok: false, status: 0 }));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', 'application/pdf');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status });
    xhr.onerror = () => resolve({ ok: false, status: 0 });
    xhr.ontimeout = () => resolve({ ok: false, status: 0 });
    xhr.send(file);
  });
}
