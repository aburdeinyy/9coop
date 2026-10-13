import { describe, expect, it } from 'vitest';
import { chatScopeKey } from '../src/app/core/utils/chat-scope';

describe('parallel run keys', () => {
  it('разные треды одной ноды — разные ключи рана', () => {
    const a = chatScopeKey('cursor-god', 'thread-1');
    const b = chatScopeKey('cursor-god', 'thread-2');
    expect(a).not.toBe(b);
  });

  it('разные ноды — разные ключи', () => {
    expect(chatScopeKey('n1', 't')).not.toBe(chatScopeKey('n2', 't'));
  });
});
