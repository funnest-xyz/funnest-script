import { describe, expect, it } from 'vitest';
import { removeGlobal } from '../src/guard';

describe('removing a global', () => {
  it('takes it off the prototype chain too (a Worker keeps performance and crypto there)', () => {
    class Scope {
      get performance() {
        return { now: () => 1 };
      }
    }
    const g = new Scope() as unknown as Record<string, unknown>;
    removeGlobal(g, 'performance');
    expect(g.performance).toBeUndefined();
    const getter = Object.getOwnPropertyDescriptor(Scope.prototype, 'performance');
    expect(getter).toBeUndefined();
    // And it stays gone.
    expect(() => {
      'use strict';
      g.performance = 5;
    }).toThrow();
  });
});
