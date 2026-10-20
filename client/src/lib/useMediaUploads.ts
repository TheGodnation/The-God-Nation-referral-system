import { useEffect, useRef, useState } from 'react';
import {
  ChatUploadError,
  UploadCancelled,
  baseMime,
  extensionFor,
  makeThumb,
  shrinkPhoto,
  uploadChatFile,
  type UploadedAttachment,
  type UploadProblem,
} from './chatMedia';
import type { OutgoingMessage } from '../components/chat/ChatComposer';

// Photos, videos and documents sent the WhatsApp way: once Send is tapped
// on the preview screen they show in the chat as your own message with a progress circle,
// upload in the background, and are posted once every file is up. The ✕
// stops one; a failed one can be tried again without uploading what
// already went up.
export interface MediaPreview {
  name: string;
  kind: 'photo' | 'video' | 'document';
  previewUrl: string | null;
}

export interface MediaSendJob {
  id: string;
  items: MediaPreview[];
  /** 0–1 across all the files in this message. */
  progress: number;
  status: 'uploading' | 'sending' | 'failed';
  problem?: UploadProblem;
  caption?: string;
}

interface JobWork {
  files: File[];
  caption?: string;
  replyToMessageId?: string;
  controller: AbortController;
  uploaded?: UploadedAttachment[];
}

function kindOf(file: File): MediaPreview['kind'] {
  const type = baseMime(file.type);
  return type.startsWith('image/') ? 'photo' : type.startsWith('video/') ? 'video' : 'document';
}

function objectUrl(b: Blob): string | null {
  return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(b) : null;
}

let counter = 0;

export function useMediaUploads(uploadPath: string, post: (out: OutgoingMessage) => Promise<boolean>) {
  const [jobs, setJobs] = useState<MediaSendJob[]>([]);
  const work = useRef(new Map<string, JobWork>());
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const postRef = useRef(post);
  postRef.current = post;

  useEffect(
    () => () => {
      for (const w of work.current.values()) w.controller.abort();
      for (const job of jobsRef.current) job.items.forEach((i) => i.previewUrl && URL.revokeObjectURL?.(i.previewUrl));
    },
    [],
  );

  function update(id: string, patch: Partial<MediaSendJob>) {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }

  function finish(id: string) {
    work.current.delete(id);
    setJobs((prev) => {
      prev.find((j) => j.id === id)?.items.forEach((i) => i.previewUrl && URL.revokeObjectURL?.(i.previewUrl));
      return prev.filter((j) => j.id !== id);
    });
  }

  async function uploadAll(id: string, w: JobWork): Promise<UploadedAttachment[]> {
    const fractions = w.files.map(() => 0);
    const report = () => update(id, { progress: fractions.reduce((a, b) => a + b, 0) / fractions.length });
    return Promise.all(
      w.files.map(async (file, i) => {
        const type = baseMime(file.type);
        let blob: Blob = file;
        let name = file.name || `file.${extensionFor(type)}`;
        let thumb: string | undefined;
        if (type.startsWith('image/')) {
          blob = await shrinkPhoto(file);
          if (blob !== file) name = name.replace(/\.[^.]+$/, '') + '.jpg';
          thumb = await makeThumb(blob);
        }
        const up = await uploadChatFile(uploadPath, blob, name, {
          signal: w.controller.signal,
          onProgress: (f) => {
            fractions[i] = f;
            report();
          },
        });
        fractions[i] = 1;
        report();
        return thumb ? { ...up, thumb } : up;
      }),
    );
  }

  async function run(id: string) {
    const w = work.current.get(id);
    if (!w) return;
    w.controller = new AbortController();
    const { signal } = w.controller;
    update(id, { status: w.uploaded ? 'sending' : 'uploading', problem: undefined });
    try {
      if (!w.uploaded) w.uploaded = await uploadAll(id, w);
      if (signal.aborted) return;
      update(id, { status: 'sending', progress: 1 });
      const ok = await postRef.current({ body: w.caption, attachments: w.uploaded, replyToMessageId: w.replyToMessageId });
      if (!work.current.has(id)) return;
      if (ok) finish(id);
      else update(id, { status: 'failed', problem: 'failed' });
    } catch (err) {
      if (err instanceof UploadCancelled || signal.aborted) return;
      w.controller.abort(); // stop the message's other files too
      update(id, { status: 'failed', problem: err instanceof ChatUploadError ? err.reason : 'failed' });
    }
  }

  function start(files: File[], replyToMessageId?: string, caption?: string) {
    if (files.length === 0) return;
    counter += 1;
    const id = `upload-${Date.now()}-${counter}`;
    const items = files.map((f) => {
      const kind = kindOf(f);
      return { name: f.name, kind, previewUrl: kind === 'document' ? null : objectUrl(f) };
    });
    work.current.set(id, { files, caption, replyToMessageId, controller: new AbortController() });
    setJobs((prev) => [...prev, { id, items, caption, progress: 0, status: 'uploading' }]);
    void run(id);
  }

  function cancel(id: string) {
    work.current.get(id)?.controller.abort();
    finish(id);
  }

  function retry(id: string) {
    void run(id);
  }

  return { jobs, start, cancel, retry };
}
