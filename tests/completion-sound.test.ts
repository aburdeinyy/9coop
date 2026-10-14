import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COMPLETION_CHIME_NOTES,
  playCompletionSound,
  resetCompletionSoundContext,
  scheduleCompletionChime,
  shouldPlayCompletionSound,
  type CompletionSoundAudio,
} from '../src/app/core/utils/completion-sound';

type MockOsc = {
  type: string;
  frequency: { value: number };
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
};

type MockGain = {
  gain: {
    setValueAtTime: ReturnType<typeof vi.fn>;
    exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
  };
  connect: ReturnType<typeof vi.fn>;
};

function mockAudio(state: AudioContextState = 'running'): CompletionSoundAudio & {
  oscillators: MockOsc[];
  gains: MockGain[];
  ctx: {
    state: AudioContextState;
    currentTime: number;
    destination: object;
    createOscillator: ReturnType<typeof vi.fn>;
    createGain: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
  };
} {
  const oscillators: MockOsc[] = [];
  const gains: MockGain[] = [];
  const ctx = {
    state,
    currentTime: 1.5,
    destination: {},
    createOscillator: vi.fn(() => {
      const osc: MockOsc = {
        type: '',
        frequency: { value: 0 },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      oscillators.push(osc);
      return osc;
    }),
    createGain: vi.fn(() => {
      const gain: MockGain = {
        gain: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
      };
      gains.push(gain);
      return gain;
    }),
    resume: vi.fn(() => {
      ctx.state = 'running';
      return Promise.resolve();
    }),
  };
  return {
    oscillators,
    gains,
    ctx,
    createContext: () => ctx as unknown as AudioContext,
  };
}

afterEach(() => {
  resetCompletionSoundContext();
});

describe('shouldPlayCompletionSound', () => {
  it('играет только при успехе и включённой настройке', () => {
    expect(shouldPlayCompletionSound({ enabled: true, aborted: false })).toBe(true);
    expect(shouldPlayCompletionSound({ enabled: false, aborted: false })).toBe(false);
    expect(shouldPlayCompletionSound({ enabled: true, aborted: true })).toBe(false);
  });
});

describe('COMPLETION_CHIME_NOTES', () => {
  it('три восходящие ноты Layercoop (не копия 9th join C5→G5)', () => {
    expect(COMPLETION_CHIME_NOTES).toHaveLength(3);
    const freqs = COMPLETION_CHIME_NOTES.map((n) => n.freq);
    expect(freqs[1]!).toBeGreaterThan(freqs[0]!);
    expect(freqs[2]!).toBeGreaterThan(freqs[1]!);
    // не совпадать с 9th JOIN_CHIME (523.25 / 784)
    expect(freqs).not.toContain(523.25);
    expect(freqs).not.toContain(784.0);
    expect(COMPLETION_CHIME_NOTES[0]).toMatchObject({ freq: 659.25, start: 0 });
    expect(COMPLETION_CHIME_NOTES[1]).toMatchObject({ freq: 830.61, start: 0.06 });
    expect(COMPLETION_CHIME_NOTES[2]).toMatchObject({ freq: 987.77, start: 0.13 });
  });
});

describe('scheduleCompletionChime', () => {
  it('ставит sine-ноты с экспоненциальным затуханием', () => {
    const audio = mockAudio();
    const ctx = audio.createContext();
    scheduleCompletionChime(ctx);

    expect(audio.ctx.createOscillator).toHaveBeenCalledTimes(3);
    expect(audio.oscillators[0]!.type).toBe('sine');
    expect(audio.oscillators.map((o) => o.frequency.value)).toEqual([
      659.25, 830.61, 987.77,
    ]);

    expect(audio.gains[0]!.gain.setValueAtTime).toHaveBeenCalledWith(0.045, 1.5);
    expect(audio.gains[0]!.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(
      0.0001,
      1.5 + 0.09,
    );
    expect(audio.gains[2]!.gain.setValueAtTime).toHaveBeenCalledWith(0.06, 1.5 + 0.13);
    expect(audio.oscillators[2]!.stop).toHaveBeenCalledWith(1.5 + 0.13 + 0.2);
  });
});

describe('playCompletionSound', () => {
  it('играет трёхнотный chime', () => {
    const audio = mockAudio();
    playCompletionSound(audio);
    expect(audio.ctx.createOscillator).toHaveBeenCalledTimes(3);
  });

  it('resume + play, если контекст suspended', async () => {
    const audio = mockAudio('suspended');
    playCompletionSound(audio);

    expect(audio.ctx.resume).toHaveBeenCalledOnce();
    expect(audio.oscillators).toHaveLength(0);
    await Promise.resolve();
    expect(audio.oscillators).toHaveLength(3);
  });

  it('переиспользует AudioContext между вызовами', () => {
    const audio = mockAudio();
    const create = vi.fn(audio.createContext);
    playCompletionSound({ createContext: create });
    playCompletionSound({ createContext: create });
    expect(create).toHaveBeenCalledOnce();
  });

  it('молчит при ошибке AudioContext', () => {
    expect(() =>
      playCompletionSound({
        createContext: () => {
          throw new Error('no audio');
        },
      }),
    ).not.toThrow();
  });
});
