/** Counts memory in this realm before anything else is made: imported first by worker-entry.ts only (a named import, so bundlers keep it). */
import { installMemoryGuard } from './guard';

export const GUARDED = (installMemoryGuard(), true);
