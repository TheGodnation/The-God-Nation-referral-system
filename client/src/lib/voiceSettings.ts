// Whether the voice sound tuning is used: the clean-up when recording (noise reduction, warmth, gate, compressor, 64 kbps) and the
// loudness boost when playing. It is SWITCHED OFF: voice notes are recorded and played exactly as they were before the tuning was
// started (the phone's plain microphone, 32 kbps in chats, and the plain audio player). The tuning code is kept, ready to be worked on
// again later; switching this on is the only thing that brings it back.
let on = false;

export const voiceProcessingOn = (): boolean => on;

/** Switches the tuning on or off (used by tests, and later when the tuning is worked on again). */
export function setVoiceProcessing(value: boolean): void {
  on = value;
}
