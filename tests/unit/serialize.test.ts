import { describe, expect, it } from 'vitest';
import { captureStack, formatArgs, serializeArg, serializeArgs } from '../../src/core/serialize';

describe('serializeArg', () => {
  it('renders primitives', () => {
    expect(serializeArg('hello')).toBe('hello');
    expect(serializeArg(42)).toBe('42');
    expect(serializeArg(true)).toBe('true');
    expect(serializeArg(null)).toBe('null');
    expect(serializeArg(undefined)).toBe('undefined');
    expect(serializeArg(10n)).toBe('10n');
    expect(serializeArg(Symbol('x'))).toBe('Symbol(x)');
  });

  it('quotes nested strings but not top-level ones', () => {
    expect(serializeArg({ a: 'b' })).toBe('{a: "b"}');
  });

  it('handles circular references', () => {
    const node: Record<string, unknown> = { name: 'root' };
    node.self = node;
    expect(serializeArg(node)).toBe('{name: "root", self: [Circular]}');
  });

  it('serializes errors with their stack', () => {
    const error = new TypeError('boom');
    error.stack = 'TypeError: boom\n    at test';
    expect(serializeArg(error)).toContain('TypeError: boom');
    expect(serializeArg(error)).toContain('at test');
  });

  it('describes DOM nodes', () => {
    const element = document.createElement('div');
    element.id = 'main';
    element.className = 'a b';
    expect(serializeArg(element)).toBe('<div#main.a.b>');
  });

  it('renders Map, Set, Date and RegExp', () => {
    expect(serializeArg(new Map([['a', 1]]))).toBe('Map(1) {"a" => 1}');
    expect(serializeArg(new Set([1, 2]))).toBe('Set(2) {1, 2}');
    expect(serializeArg(new Date('2024-01-01T00:00:00.000Z'))).toBe('2024-01-01T00:00:00.000Z');
    expect(serializeArg(/ab+c/gi)).toBe('/ab+c/gi');
  });

  it('names class instances', () => {
    class User {
      constructor(readonly id: number) {}
    }
    expect(serializeArg(new User(7))).toBe('User {id: 7}');
  });

  it('truncates long strings', () => {
    const result = serializeArg('x'.repeat(50), { maxStringLength: 10 });
    expect(result.startsWith('xxxxxxxxxx')).toBe(true);
    expect(result).toContain('truncated 40 chars');
  });

  it('caps array and object size', () => {
    expect(serializeArg([1, 2, 3, 4], { maxArrayLength: 2 })).toBe('[1, 2, … 2 more]');
    expect(serializeArg({ a: 1, b: 2, c: 3 }, { maxProperties: 2 })).toBe('{a: 1, b: 2, … 1 more}');
  });

  it('stops at max depth', () => {
    expect(serializeArg({ a: { b: { c: { d: 1 } } } }, { maxDepth: 2 })).toBe('{a: {b: [Object]}}');
  });

  it('never throws on hostile getters', () => {
    const hostile = {
      get boom() {
        throw new Error('nope');
      },
    };
    expect(() => serializeArg(hostile)).not.toThrow();
    expect(serializeArg(hostile)).toContain('Unserializable');
  });

  it('serializes and formats argument lists', () => {
    expect(formatArgs(serializeArgs(['count:', 3]))).toBe('count: 3');
  });
});

describe('captureStack', () => {
  it('returns a stack trace string', () => {
    expect(typeof captureStack()).toBe('string');
  });
});
