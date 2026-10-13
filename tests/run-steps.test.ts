import { describe, expect, it } from 'vitest';
import {
  finalizeRunSteps,
  reduceRunSteps,
  type ChatRunStep,
} from '../src/app/core/utils/run-steps';

let seq = 0;
const nextId = () => `s${++seq}`;

describe('reduceRunSteps', () => {
  it('токены копят в текущий thought-шаг', () => {
    seq = 0;
    let steps: ChatRunStep[] = [];
    steps = reduceRunSteps(steps, { type: 'token', text: 'A' }, nextId);
    steps = reduceRunSteps(steps, { type: 'token', text: 'B' }, nextId);
    expect(steps).toEqual([
      { id: 's1', kind: 'thought', label: 'Мысль', text: 'AB', status: 'running' },
    ]);
  });

  it('tool start закрывает thought и открывает tool-шаг', () => {
    seq = 0;
    let steps: ChatRunStep[] = [];
    steps = reduceRunSteps(steps, { type: 'token', text: 'думаю' }, nextId);
    steps = reduceRunSteps(
      steps,
      { type: 'tool', name: 'shell', status: 'start', callId: 'c1' },
      nextId,
    );
    expect(steps[0]).toMatchObject({ kind: 'thought', status: 'done', text: 'думаю' });
    expect(steps[1]).toEqual({
      id: 'c1',
      kind: 'tool',
      label: 'Выполняю команду…',
      text: '',
      status: 'running',
    });
  });

  it('tool detail становится label', () => {
    seq = 0;
    let steps: ChatRunStep[] = [];
    steps = reduceRunSteps(
      steps,
      {
        type: 'tool',
        name: 'grep',
        status: 'start',
        callId: 'c1',
        detail: 'Ищу «foo»',
      },
      nextId,
    );
    expect(steps[0]!.label).toBe('Ищу «foo»');
  });


  it('tool end помечает шаг done; следующий token — новый thought', () => {
    seq = 0;
    let steps: ChatRunStep[] = [];
    steps = reduceRunSteps(
      steps,
      { type: 'tool', name: 'read', status: 'start', callId: 'c1' },
      nextId,
    );
    steps = reduceRunSteps(
      steps,
      { type: 'tool', name: 'read', status: 'end', callId: 'c1' },
      nextId,
    );
    steps = reduceRunSteps(steps, { type: 'token', text: 'ок' }, nextId);
    expect(steps.map((s) => s.status)).toEqual(['done', 'running']);
    expect(steps[1]).toMatchObject({ kind: 'thought', text: 'ок' });
  });

  it('finalizeRunSteps закрывает running', () => {
    const steps: ChatRunStep[] = [
      { id: '1', kind: 'thought', label: 'Мысль', text: 'x', status: 'running' },
    ];
    expect(finalizeRunSteps(steps)[0]!.status).toBe('done');
  });
});
