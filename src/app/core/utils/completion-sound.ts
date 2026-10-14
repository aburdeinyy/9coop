/** Короткий стеклянный chime после успешного рана */

export interface CompletionSoundAudio {
  createContext: () => AudioContext;
}

export type CompletionChimeNote = {
  freq: number;
  start: number;
  dur: number;
  gain: number;
};

/** Две восходящие ноты с экспоненциальным затуханием (~0.4 с). */
export const COMPLETION_CHIME_NOTES: readonly CompletionChimeNote[] = [
  { freq: 523.25, start: 0, dur: 0.14, gain: 0.055 },
  { freq: 784.0, start: 0.1, dur: 0.28, gain: 0.07 },
];

let sharedCtx: AudioContext | null = null;

export function shouldPlayCompletionSound(opts: {
  enabled: boolean;
  aborted: boolean;
}): boolean {
  return opts.enabled && !opts.aborted;
}

export function scheduleCompletionChime(
  ctx: AudioContext,
  notes: readonly CompletionChimeNote[] = COMPLETION_CHIME_NOTES,
  at = ctx.currentTime,
): void {
  if (ctx.state === "closed") return;
  for (const note of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = note.freq;
    const start = at + note.start;
    const end = start + note.dur;
    gain.gain.setValueAtTime(note.gain, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(end);
  }
}

export function playCompletionSound(
  audio: CompletionSoundAudio = defaultAudio(),
): void {
  try {
    const ctx = resolveContext(audio);
    const play = () => scheduleCompletionChime(ctx);
    if (ctx.state === "suspended") {
      void ctx
        .resume()
        .then(play)
        .catch(() => undefined);
      return;
    }
    play();
  } catch {
    // Autoplay / insecure context / missing Web Audio — молча пропускаем.
  }
}

/** Сброс singleton — только для тестов. */
export function resetCompletionSoundContext(): void {
  sharedCtx = null;
}

function resolveContext(audio: CompletionSoundAudio): AudioContext {
  if (sharedCtx && sharedCtx.state !== "closed") return sharedCtx;
  sharedCtx = audio.createContext();
  return sharedCtx;
}

function defaultAudio(): CompletionSoundAudio {
  return {
    createContext: () => {
      const Ctor =
        typeof AudioContext !== "undefined"
          ? AudioContext
          : (
              globalThis as unknown as {
                webkitAudioContext?: typeof AudioContext;
              }
            ).webkitAudioContext;
      if (!Ctor) throw new Error("AudioContext unavailable");
      return new Ctor();
    },
  };
}
