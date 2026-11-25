// Only one voice note (or any other sound in the app) plays at a time: starting one pauses whichever was playing, like WhatsApp.
// One listener on the whole page catches every audio and video, wherever it is (chats, teachings, the feed). A muted video, such as
// a thumbnail, does not pause anything.

let installed = false;

export function installOneSoundAtATime(doc: Document = document): void {
  if (installed) return;
  installed = true;
  // "play" does not bubble, so it is caught on its way down.
  doc.addEventListener(
    'play',
    (e) => {
      const started = e.target;
      if (!(started instanceof HTMLMediaElement) || started.muted) return;
      doc.querySelectorAll('audio, video').forEach((el) => {
        const other = el as HTMLMediaElement;
        if (other !== started && !other.paused && !other.muted) other.pause();
      });
    },
    true,
  );
}

/** For tests. */
export function resetOneSoundForTests(): void {
  installed = false;
}
