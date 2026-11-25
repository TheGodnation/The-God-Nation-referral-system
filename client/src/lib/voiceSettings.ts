// Whether the voice clean-up is used when recording (warmth, noise gate, compressor on top of the phone's own voice cleaner). It is
// SWITCHED OFF: the phone's plain microphone is recorded (at 64 kbps, see voiceCapture), because that extra processing made voices
// sound noisy and harsh. Playback evens out the loudness of every note instead (see voiceLevel), with no processing of the voice.
let on = false;

export const voiceProcessingOn = (): boolean => on;

/** Switches the tuning on or off (used by tests, and later when the tuning is worked on again). */
export function setVoiceProcessing(value: boolean): void {
  on = value;
}
