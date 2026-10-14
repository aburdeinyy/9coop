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
  it('две восходящие ноты как join-chime в 9th', () => {
    expect(COMPLETION_CHIME_NOTES).toHaveLength(2);
    expect(COMPLETION_CHIME_NOTES[1]!.freq).toBeGreaterThan(COMPLETION_CHIME_NOTES[0]!.freq);
    expect(COMPLETION_CHIME_NOTES[0]).toMatchObject({ freq: 523.25, start: 0 });
    expect(COMPLETION_CHIME_NOTES[1]).toMatchObject({ freq: 784.0, start: 0.1 });
  });
});

describe('scheduleCompletionChime', () => {
  it('ставит sine-ноты с экспоненциальным затуханием', () => {
    const audio = mockAudio();
    const ctx = audio.createContext();
    scheduleCompletionChime(ctx);

    expect(audio.ctx.createOscillator).toHaveBeenCalledTimes(2);
    expect(audio.oscillators[0]!.type).toBe('sine');
    expect(audio.oscillators[0]!.frequency.value).toBe(523.25);
    expect(audio.oscillators[1]!.frequency.value).toBe(784.0);

    expect(audio.gains[0]!.gain.setValueAtTime).toHaveBeenCalledWith(0.055, 1.5);
    expect(audio.gains[0]!.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(
      0.0001,
      1.5 + 0.14,
    );
    expect(audio.gains[1]!.gain.setValueAtTime).toHaveBeenCalledWith(0.07, 1.5 + 0.1);
    expect(audio.gains[1]!.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(
      0.0001,
      1.5 + 0.1 + 0.28,
    );

    expect(audio.oscillators[0]!.start).toHaveBeenCalledWith(1.5);
    expect(audio.oscillators[0]!.stop).toHaveBeenCalledWith(1.5 + 0.14);
    expect(audio.oscillators[1]!.start).toHaveBeenCalledWith(1.5 + 0.1);
    expect(audio.oscillators[1]!.stop).toHaveBeenCalledWith(1.5 + 0.1 + 0.28);
  });
});

describe('playCompletionSound', () => {
  it('играет двунотный chime', () => {
    const audio = mockAudio();
    playCompletionSound(audio);
    expect(audio.ctx.createOscillator).toHaveBeenCalledTimes(2);
  });

  it('resume + play, если контекст suspended', async () => {
    const audio = mockAudio('suspended');
    playCompletionSound(audio);

    expect(audio.ctx.resume).toHaveBeenCalledOnce();
    expect(audio.oscillators).toHaveLength(0);
    await Promise.resolve();
    expect(audio.oscillators).toHaveLength(2);
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
