import { describe, expect, it } from 'vitest';
import { RewindBuffer } from '../../src/core/rewind';

describe('RewindBuffer', () => {
  it('keeps the configured circular window', () => {
    const buffer = new RewindBuffer<string>(120_000);
    buffer.push('old', 0);
    buffer.push('new', 121_000);
    expect(buffer.values()).toEqual(['new']);
  });
});
