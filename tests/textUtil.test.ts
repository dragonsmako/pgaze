import { describe, expect, it } from 'vitest';
import { clip, pad, sanitizeCell, stripAnsi, truncate } from '../src/lib/textUtil.js';

describe('truncate', () => {
  it('returns the string unchanged when it fits', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('appends an ellipsis when cut', () => {
    expect(truncate('hello world', 8)).toBe('hello w…');
  });

  it('handles width 0', () => {
    expect(truncate('x', 0)).toBe('');
  });

  it('handles width 1', () => {
    expect(truncate('xy', 1)).toBe('…');
  });
});

describe('pad', () => {
  it('pads to width', () => {
    expect(pad('hi', 5)).toBe('hi   ');
  });

  it('truncates with ellipsis when over width', () => {
    expect(pad('toolong', 4)).toBe('too…');
  });
});

describe('clip', () => {
  it('does not pad', () => {
    expect(clip('hi', 5)).toBe('hi');
  });

  it('hard cuts without ellipsis', () => {
    expect(clip('hello', 3)).toBe('hel');
  });
});

describe('stripAnsi', () => {
  it('removes color codes', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m')).toBe('red');
  });

  it('removes OSC sequences (BEL terminator)', () => {
    expect(stripAnsi('hi\x1b]52;c;Zm9v\x07there')).toBe('hithere');
  });

  it('removes OSC sequences (ST terminator)', () => {
    expect(stripAnsi('a\x1b]0;title\x1b\\b')).toBe('ab');
  });

  it('removes DEL/control chars', () => {
    expect(stripAnsi('a\x7fb')).toBe('ab');
  });

  it('keeps ordinary text', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });
});

describe('sanitizeCell', () => {
  it('strips ANSI and collapses whitespace', () => {
    expect(sanitizeCell('a\x1b[31mb\nc\td')).toBe('ab c d');
  });
});
