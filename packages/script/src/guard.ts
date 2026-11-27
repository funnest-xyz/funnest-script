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

/**
 * Takes a global away for good: off the global object and off every prototype in its chain (in a
 * Worker, `performance` and `crypto` are getters on WorkerGlobalScope.prototype — shadowing them on
 * the global alone leaves the getter reachable), then pinned to undefined.
 */
export function removeGlobal(g: G, name: string): void {
  for (let o: object | null = g; o; o = Object.getPrototypeOf(o)) {
    if (!Object.prototype.hasOwnProperty.call(o, name)) continue;
    try {
      delete (o as G)[name];
    } catch {
      // not configurable: pinned below where it can be
    }
  }
  try {
    Object.defineProperty(g, name, { configurable: false, writable: false, value: undefined });
  } catch {
    // already pinned
  }
}

let installed = false;

/** The realm's Blob, kept for the runtime's own use (loading a script as a blob) after it's removed from scripts' reach. */
export let realmBlob: typeof Blob | undefined;

/** Globals a script could allocate memory with uncounted, or start another realm / reach out with (where the realm has them). */
const REMOVE = ['WebAssembly', 'SharedArrayBuffer', 'Atomics', 'Worker', 'SharedWorker', 'structuredClone', 'Blob', 'File', 'FileReader', 'FileReaderSync', 'Response', 'Request', 'ImageData', 'OffscreenCanvas', 'createImageBitmap', 'CompressionStream', 'DecompressionStream', 'TextEncoder', 'TextEncoderStream', 'WebTransport'];

/** A length as the engine reads it (ToIndex), read once: a value with valueOf can't say one thing to the count and another to the engine. */
function toIndex(v: unknown): number {
  const n = Number(v);
  const i = Number.isNaN(n) ? 0 : Math.trunc(n);
  if (i < 0 || !Number.isFinite(i) || i > Number.MAX_SAFE_INTEGER) throw new RangeError('Invalid array length');
  return i;
}

/**
 * Counts typed array and buffer memory; removes what can't be counted. Idempotent.
 *
 * Every way to new memory is counted where the engine can't be fooled: the constructors (sizes
 * read once and handed on as plain numbers or arrays), and the methods that copy (slice, map,
 * filter, toSorted…; a script may set an array's `constructor` to dodge the constructors), with
 * the engine's own length getters taken before any script runs.
 */
export function installMemoryGuard(g: G = globalThis as unknown as G): void {
  if (installed) return;
  installed = true;
  let used = 0;
  const charge = (bytes: number) => {
    if (!Number.isFinite(bytes) || bytes < 0) throw new RangeError(MEMORY);
    if (bytes > MAX_ONE || (used += bytes) > MAX_TOTAL) throw new RangeError(MEMORY);
  };
  const lock = (o: object, key: string, value: unknown) => Object.defineProperty(o, key, { configurable: false, writable: false, value });

  const OriginalBuffer = g.ArrayBuffer as ArrayBufferConstructor;
  const bufferLength = Object.getOwnPropertyDescriptor(OriginalBuffer.prototype, 'byteLength')!.get!;
  /** The bytes of a real ArrayBuffer, or -1 for anything else (an object only dressed as one). */
  const bufferBytes = (v: unknown): number => {
    try {
      return bufferLength.call(v) as number;
    } catch {
      return -1;
    }
  };
  const TypedArray = Object.getPrototypeOf(g.Uint8Array as object) as { prototype: object };
  const taLength = Object.getOwnPropertyDescriptor(TypedArray.prototype, 'length')!.get!;
  const taBytes = Object.getOwnPropertyDescriptor(TypedArray.prototype, 'byteLength')!.get!;
  /** The length of a real typed array, or -1. */
  const arrayLength = (v: unknown): number => {
    try {
      return taLength.call(v) as number;
    } catch {
      return -1;
    }
  };

  // ArrayBuffer: its length, or the most a resizable one may grow to.
  const Buffer: ArrayBufferConstructor = new Proxy(OriginalBuffer, {
    construct(target, args: unknown[], newTarget): object {
      const len = toIndex(args[0]);
      const opts = args[1];
      const maxRaw = opts !== null && typeof opts === 'object' ? (opts as { maxByteLength?: unknown }).maxByteLength : undefined;
      const max = maxRaw === undefined ? undefined : toIndex(maxRaw);
      charge(Math.max(len, max ?? 0));
      return Reflect.construct(target, max === undefined ? [len] : [len, { maxByteLength: max }], newTarget === Buffer ? target : newTarget);
    },
  });
  const wrap = (proto: object, name: string, bytes: (self: unknown, args: unknown[]) => number, args?: (a: unknown[]) => unknown[]) => {
    const original = (proto as G)[name] as ((...a: unknown[]) => unknown) | undefined;
    if (typeof original !== 'function') return;
    lock(proto, name, function (this: unknown, ...a: unknown[]) {
      const fixed = args ? args(a) : a;
      charge(bytes(this, fixed));
      return original.apply(this, fixed);
    });
  };
  wrap(OriginalBuffer.prototype, 'slice', (self) => bufferBytes(self));
  for (const name of ['transfer', 'transferToFixedLength'])
    wrap(OriginalBuffer.prototype, name, (self, a) => (a[0] === undefined ? bufferBytes(self) : (a[0] as number)), (a) => (a[0] === undefined ? [] : [toIndex(a[0])]));
  lock(OriginalBuffer.prototype, 'constructor', Buffer);
  g.ArrayBuffer = Buffer;

  // Typed array methods that make a new array the size of this one (whatever `constructor` says).
  for (const name of ['slice', 'map', 'filter', 'toReversed', 'toSorted', 'with'])
    wrap(TypedArray.prototype, name, (self) => {
      try {
        return taBytes.call(self) as number;
      } catch {
        return 0; // not a typed array: the engine throws
      }
    });

  for (const name of ['Float64Array', 'Float32Array', 'Float16Array', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'BigInt64Array', 'BigUint64Array']) {
    const T = g[name] as (Function & { BYTES_PER_ELEMENT: number; prototype: object }) | undefined;
    if (typeof T !== 'function') continue;
    const size = T.BYTES_PER_ELEMENT;
    const P: Function = new Proxy(T, {
      construct(target, args: unknown[], newTarget) {
        const a = args[0];
        const nt = newTarget === P ? target : newTarget;
        // new T(length): read once, handed on as a number.
        if (a === null || typeof a !== 'object') {
          const len = toIndex(a);
          charge(len * size);
          return Reflect.construct(target, [len], nt);
        }
        // A view on a real buffer allocates nothing (the buffer was counted).
        if (bufferBytes(a) >= 0) return Reflect.construct(target, args, nt);
        // A copy of a real typed array: its length can't be faked.
        const n = arrayLength(a);
        if (n >= 0) {
          charge(n * size);
          return Reflect.construct(target, [a], nt);
        }
        // Anything else: an iterable is made into a plain array first (on the heap), an array-like is
        // read up to the length it says once — refused before anything is made when that's too much.
        let list: unknown[];
        if (typeof (a as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function') list = Array.from(a as Iterable<unknown>);
        else {
          const len = Math.min(toIndex((a as { length?: unknown }).length ?? 0), Number.MAX_SAFE_INTEGER);
          if (len * size > MAX_ONE) throw new RangeError(MEMORY);
          list = new Array<unknown>(len);
          for (let k = 0; k < len; k++) list[k] = (a as Record<number, unknown>)[k];
        }
        charge(list.length * size);
        return Reflect.construct(target, [list], nt);
      },
    });
    // map, slice… make their result through `constructor` (species): counted there too.
    Object.defineProperty(T.prototype, 'constructor', { configurable: false, writable: false, value: P });
    g[name] = P;
  }
  for (const name of REMOVE) {
    if (name === 'Blob' && typeof g.Blob === 'function') realmBlob = g.Blob as typeof Blob;
    if (name in g) removeGlobal(g, name);
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

  for (const name of ['performance', 'crypto']) removeGlobal(g, name);
}
