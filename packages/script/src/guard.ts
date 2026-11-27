/**
 * Guards for the realm a script runs in: the sandbox Worker in the app, a vm context in the CLI /
 * MCP tools (and, later, a server). Each run has a realm of its own (a new Worker, a new process),
 * so its globals can be changed here. Only the bundled runtime (worker-entry.ts) installs them —
 * never a host that imports the package.
 *
 * Scripts can reach the realm's globals (`globalThis.Math.random`), so hiding names in the
 * script's scope isn't enough; these close the doors in the realm itself.
 *
 * - Memory: typed arrays and ArrayBuffers live outside the JavaScript heap, so a heap limit
 *   (Node's --max-old-space-size, a browser tab's) doesn't stop `new Float64Array(2 ** 30)`.
 *   Every allocation is counted here: one may take MAX_ONE bytes, a run MAX_TOTAL in all.
 *   WebAssembly memories and shared buffers, which can't be counted, are removed.
 * - Clock and dice (installed for v2 scripts, `hardenClock`): the same chart must give the same
 *   result, so the realm's Math.random, a Date of "now", Intl formatting "now", performance and
 *   crypto randomness are refused too.
 */

/** Bytes one typed array or buffer may take. */
export const MAX_ONE = 256 * 1024 * 1024;
/** Bytes a run may allocate in typed arrays and buffers, all together (freed ones count too). */
export const MAX_TOTAL = 2 * 1024 * 1024 * 1024;

const MEMORY = '스크립트가 메모리를 너무 많이 써요. 배열 크기와 반복문을 확인해 주세요. (Script uses too much memory.)';
const CLOCK = '스크립트에서는 현재 시각 · 난수를 쓸 수 없어요. 봉 시각은 time[i]를 쓰세요. (No clock or randomness in scripts.)';

type G = Record<string, unknown>;

let installed = false;

/** Counts typed array and buffer memory; removes what can't be counted. Idempotent. */
export function installMemoryGuard(g: G = globalThis as unknown as G): void {
  if (installed) return;
  installed = true;
  let used = 0;
  const charge = (bytes: number) => {
    if (!Number.isFinite(bytes) || bytes < 0) return;
    if (bytes > MAX_ONE || (used += bytes) > MAX_TOTAL) throw new RangeError(MEMORY);
  };
  const OriginalBuffer = g.ArrayBuffer as ArrayBufferConstructor;

  // ArrayBuffer: its length, or the most a resizable one may grow to.
  const Buffer: ArrayBufferConstructor = new Proxy(OriginalBuffer, {
    construct(target, args: unknown[], newTarget): object {
      const opts = args[1] as { maxByteLength?: unknown } | undefined;
      const max = opts && typeof opts === 'object' && opts.maxByteLength !== undefined ? Number(opts.maxByteLength) : 0;
      charge(Math.max(Number(args[0]) || 0, max || 0));
      return Reflect.construct(target, args, newTarget === Buffer ? target : newTarget);
    },
  });
  for (const name of ['transfer', 'transferToFixedLength']) {
    const original = (OriginalBuffer.prototype as unknown as G)[name] as ((n?: number) => ArrayBuffer) | undefined;
    if (typeof original !== 'function') continue;
    Object.defineProperty(OriginalBuffer.prototype, name, {
      configurable: true,
      writable: true,
      value(this: ArrayBuffer, n?: number) {
        charge(n === undefined ? this.byteLength : Number(n));
        return original.call(this, n);
      },
    });
  }
  Object.defineProperty(OriginalBuffer.prototype, 'constructor', { configurable: true, writable: true, value: Buffer });
  g.ArrayBuffer = Buffer;

  const isBuffer = (v: unknown) => v instanceof OriginalBuffer;
  for (const name of ['Float64Array', 'Float32Array', 'Float16Array', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'BigInt64Array', 'BigUint64Array']) {
    const T = g[name] as (Function & { BYTES_PER_ELEMENT: number; prototype: object }) | undefined;
    if (typeof T !== 'function') continue;
    const size = T.BYTES_PER_ELEMENT;
    const P: Function = new Proxy(T, {
      construct(target, args: unknown[], newTarget) {
        const a = args[0];
        // A view on a buffer allocates nothing (the buffer was counted).
        const viewOnly = isBuffer(a);
        const known = typeof a === 'number' ? a : a && typeof a === 'object' && !viewOnly && typeof (a as { length?: unknown }).length === 'number' ? (a as { length: number }).length : -1;
        if (known >= 0) charge(known * size);
        const made = Reflect.construct(target, args, newTarget === P ? target : newTarget) as { byteLength: number };
        // From an iterable: counted once it's made (its items were on the heap first).
        if (known < 0 && !viewOnly) charge(made.byteLength);
        return made;
      },
    });
    // map, slice, filter… make their result through `constructor` (species): counted too.
    Object.defineProperty(T.prototype, 'constructor', { configurable: true, writable: true, value: P });
    g[name] = P;
  }
  // Memory that can't be counted, and shared memory (a way to time things precisely).
  for (const name of ['WebAssembly', 'SharedArrayBuffer', 'Atomics']) {
    try {
      delete g[name];
    } catch {
      // not configurable: shadowed below
    }
    if (name in g) Object.defineProperty(g, name, { configurable: false, writable: false, value: undefined });
  }
}

let clockDone = false;

/** Refuses the realm's clock and randomness (v2 scripts). Idempotent. */
export function hardenClock(g: G = globalThis as unknown as G): void {
  if (clockDone) return;
  clockDone = true;
  const refuse = () => {
    throw new Error(CLOCK);
  };
  const math = g.Math as G | undefined;
  if (math) Object.defineProperty(math, 'random', { configurable: false, writable: false, value: refuse });

  // Date: as a function or with no argument it means "now".
  const RealDate = g.Date as DateConstructor;
  const SafeDate: DateConstructor = new Proxy(RealDate, {
    apply: refuse,
    construct(target, args: unknown[], newTarget): object {
      if (!args.length) refuse();
      return Reflect.construct(target, args, newTarget === SafeDate ? target : newTarget);
    },
    get(target, key, receiver) {
      if (key === 'now') return refuse;
      return Reflect.get(target, key, receiver);
    },
  });
  Object.defineProperty(RealDate.prototype, 'constructor', { configurable: false, writable: false, value: SafeDate });
  g.Date = SafeDate;

  // Intl formats "now" when given no date.
  const intl = g.Intl as { DateTimeFormat?: { prototype: object } } | undefined;
  const dtf = intl?.DateTimeFormat?.prototype;
  if (dtf) {
    const formatGet = Object.getOwnPropertyDescriptor(dtf, 'format')?.get;
    if (formatGet)
      Object.defineProperty(dtf, 'format', {
        configurable: false,
        get(this: object) {
          const f = formatGet.call(this) as (d?: unknown) => string;
          return (d?: unknown) => (d === undefined ? refuse() : f(d));
        },
      });
    const parts = (dtf as G).formatToParts as ((d?: unknown) => unknown) | undefined;
    if (typeof parts === 'function')
      Object.defineProperty(dtf, 'formatToParts', {
        configurable: false,
        writable: false,
        value(this: object, d?: unknown) {
          return d === undefined ? refuse() : parts.call(this, d);
        },
      });
  }
  // Temporal.Now, where an engine has it.
  const temporal = g.Temporal as G | undefined;
  if (temporal && 'Now' in temporal) Object.defineProperty(temporal, 'Now', { configurable: false, get: refuse });

  for (const name of ['performance', 'crypto']) Object.defineProperty(g, name, { configurable: false, writable: false, value: undefined });
}
