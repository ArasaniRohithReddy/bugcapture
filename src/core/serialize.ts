/**
 * Safe console-argument serializer.
 *
 * Runs inside the page (MAIN world), so it must be dependency-free and must
 * never throw: a broken serializer would break the host page's console.
 */

export interface SerializeOptions {
  maxDepth?: number;
  maxStringLength?: number;
  maxArrayLength?: number;
  maxProperties?: number;
}

const DEFAULTS: Required<SerializeOptions> = {
  maxDepth: 4,
  maxStringLength: 8192,
  maxArrayLength: 100,
  maxProperties: 50,
};

function truncate(value: string, max: number): string {
  return value.length > max
    ? `${value.slice(0, max)}… [truncated ${value.length - max} chars]`
    : value;
}

function describeNode(node: any): string {
  if (node.nodeType === 3) return `#text "${truncate(String(node.nodeValue ?? ''), 80)}"`;
  if (node.nodeType === 9) return '#document';
  const tag = String(node.nodeName ?? 'node').toLowerCase();
  const id = node.id ? `#${node.id}` : '';
  const className =
    typeof node.className === 'string' && node.className
      ? `.${node.className.trim().split(/\s+/).join('.')}`
      : '';
  return `<${tag}${id}${className}>`;
}

function serializeValue(
  value: unknown,
  options: Required<SerializeOptions>,
  seen: WeakSet<object>,
  depth: number,
  topLevel: boolean,
): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  const type = typeof value;
  if (type === 'string') {
    const text = truncate(value as string, options.maxStringLength);
    return topLevel ? text : JSON.stringify(text);
  }
  if (type === 'number' || type === 'boolean') return String(value);
  if (type === 'bigint') return `${String(value)}n`;
  if (type === 'symbol') return String(value);
  if (type === 'function') {
    const fn = value as (...args: unknown[]) => unknown;
    return `ƒ ${fn.name || 'anonymous'}()`;
  }

  const object = value as any;

  if (typeof Node !== 'undefined' && object instanceof Node) return describeNode(object);
  if (object instanceof Error) {
    const stack = object.stack ? `\n${object.stack}` : '';
    return truncate(`${object.name}: ${object.message}${stack}`, options.maxStringLength);
  }
  if (object instanceof Date) return object.toISOString();
  if (object instanceof RegExp) return object.toString();

  if (seen.has(object)) return '[Circular]';
  if (depth >= options.maxDepth) return Array.isArray(object) ? '[Array]' : '[Object]';
  seen.add(object);

  try {
    if (Array.isArray(object)) {
      const items = object
        .slice(0, options.maxArrayLength)
        .map((item) => serializeValue(item, options, seen, depth + 1, false));
      if (object.length > options.maxArrayLength) {
        items.push(`… ${object.length - options.maxArrayLength} more`);
      }
      return `[${items.join(', ')}]`;
    }
    if (object instanceof Map) {
      const entries: string[] = [];
      for (const [key, item] of object) {
        if (entries.length >= options.maxArrayLength) break;
        entries.push(
          `${serializeValue(key, options, seen, depth + 1, false)} => ${serializeValue(item, options, seen, depth + 1, false)}`,
        );
      }
      return `Map(${object.size}) {${entries.join(', ')}}`;
    }
    if (object instanceof Set) {
      const entries: string[] = [];
      for (const item of object) {
        if (entries.length >= options.maxArrayLength) break;
        entries.push(serializeValue(item, options, seen, depth + 1, false));
      }
      return `Set(${object.size}) {${entries.join(', ')}}`;
    }
    if (typeof Promise !== 'undefined' && object instanceof Promise) return 'Promise {}';
    if (ArrayBuffer.isView(object)) {
      return `${object.constructor?.name ?? 'TypedArray'}(${(object as any).length ?? 0})`;
    }
    if (typeof Blob !== 'undefined' && object instanceof Blob) {
      return `Blob(${object.size} bytes, ${object.type || 'unknown'})`;
    }

    const keys = Object.keys(object);
    const parts = keys
      .slice(0, options.maxProperties)
      .map((key) => `${key}: ${serializeValue(object[key], options, seen, depth + 1, false)}`);
    if (keys.length > options.maxProperties) {
      parts.push(`… ${keys.length - options.maxProperties} more`);
    }
    const name =
      object.constructor && object.constructor.name && object.constructor.name !== 'Object'
        ? `${object.constructor.name} `
        : '';
    return `${name}{${parts.join(', ')}}`;
  } catch (error) {
    return `[Unserializable: ${(error as Error)?.message ?? 'unknown error'}]`;
  } finally {
    seen.delete(object);
  }
}

/** Serialize a single console argument to a display string. */
export function serializeArg(value: unknown, options: SerializeOptions = {}): string {
  const merged = { ...DEFAULTS, ...options };
  try {
    return serializeValue(value, merged, new WeakSet<object>(), 0, true);
  } catch (error) {
    return `[Unserializable: ${(error as Error)?.message ?? 'unknown error'}]`;
  }
}

export function serializeArgs(args: readonly unknown[], options: SerializeOptions = {}): string[] {
  return Array.from(args, (arg) => serializeArg(arg, options));
}

/** Join serialized arguments the way DevTools renders a console line. */
export function formatArgs(args: readonly string[]): string {
  return args.join(' ');
}

/** Best-effort stack trace for entries that do not carry one. */
export function captureStack(skipFrames = 2): string | undefined {
  try {
    const stack = new Error('bugcapture-stack').stack;
    if (!stack) return undefined;
    return stack
      .split('\n')
      .slice(skipFrames + 1)
      .join('\n');
  } catch {
    return undefined;
  }
}
