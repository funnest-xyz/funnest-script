import { createRequire } from 'node:module';
import { DTS_TEXT } from '@funnest/script';

/**
 * Checks a script against funnest-script.d.ts with the TypeScript compiler before it runs: a
 * misspelled function ("Did you mean 'ema'?"), a missing argument, or arithmetic on a series, with
 * the exact line. Returns null when TypeScript isn't installed (the run still catches most of it).
 */

export interface TypeProblem {
  line: number;
  column: number;
  message: string;
}

const SCRIPT = '/funnest/script.js';
const DTS = '/funnest/funnest-script.d.ts';

export function typeCheck(code: string): TypeProblem[] | null {
  let ts: typeof import('typescript');
  try {
    ts = createRequire(import.meta.url)('typescript') as typeof import('typescript');
  } catch {
    return null;
  }
  const options: import('typescript').CompilerOptions = {
    allowJs: true,
    checkJs: true,
    strict: true,
    // A helper like `const mid = (len) => …` is plain JavaScript, not a mistake to report.
    noImplicitAny: false,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    lib: ['lib.es2022.d.ts'],
    types: [],
    skipLibCheck: true,
    // A script's `/// <reference path>` or `import` must not pull other files of this machine in.
    noResolve: true,
  };
  // A module: the script's own names (`const line = …`) shadow the language's instead of clashing with them.
  const files: Record<string, string> = { [SCRIPT]: `${code}\nexport {};\n`, [DTS]: DTS_TEXT };
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host);
  const exists = host.fileExists.bind(host);
  const getSource = host.getSourceFile.bind(host);
  // Only the script, the language's declarations and TypeScript's own lib files: nothing else on disk.
  const libDir = normal(host.getDefaultLibLocation?.() ?? '').replace(/\/?$/, '/');
  const isLib = (f: string) => libDir.length > 1 && normal(f).startsWith(libDir) && /\/lib\.[\w.]+\.d\.ts$/.test(normal(f));
  host.readFile = (f) => files[normal(f)] ?? (isLib(f) ? read(f) : undefined);
  host.fileExists = (f) => normal(f) in files || (isLib(f) && exists(f));
  host.directoryExists = () => false;
  host.getDirectories = () => [];
  host.getSourceFile = (f, lang, onError, create) => {
    const text = files[normal(f)];
    if (text !== undefined) return ts.createSourceFile(f, text, lang);
    return isLib(f) ? getSource(f, lang, onError, create) : undefined;
  };
  const program = ts.createProgram([DTS, SCRIPT], options, host);
  const sf = program.getSourceFile(SCRIPT)!;
  return [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)].map((d) => {
    const pos = d.start !== undefined ? sf.getLineAndCharacterOfPosition(d.start) : { line: 0, character: 0 };
    // A whole namespace spelled out ("on type '{ sma(…); ema(…); … }'") says nothing more: shorten it.
    const message = ts.flattenDiagnosticMessageText(d.messageText, '\n').replace(/'\{ [^']{60,} \}'/g, "'{…}'");
    return { line: pos.line + 1, column: pos.character + 1, message };
  });
}

const normal = (f: string) => f.replace(/\\/g, '/').replace(/^[a-z]:/i, '');
