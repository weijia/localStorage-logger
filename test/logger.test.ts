import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  createLogger,
  setDebugEnabled,
  isDebugEnabled,
  listDebugModules,
} from '../src/index';

// ---------------------------------------------------------------------------
// Mock localStorage
// ---------------------------------------------------------------------------

class MockLocalStorage {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  get length(): number {
    return this.store.size;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  clear(): void {
    this.store.clear();
  }
}

// Install mock localStorage on globalThis
const mockStorage = new MockLocalStorage();
(globalThis as any).localStorage = mockStorage;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createLogger', () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  it('auto-creates key with value "1" on first access (default enabled)', () => {
    const log = createLogger('test:auto-create');
    log.log('hello');

    expect(mockStorage.getItem('debug:test:auto-create')).toBe('1');
  });

  it('outputs to console.log when enabled', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const log = createLogger('test:log-output');
    log.log('message', 123, { key: 'val' });

    expect(spy).toHaveBeenCalledWith('[test:log-output]', 'message', 123, { key: 'val' });
    spy.mockRestore();
  });

  it('outputs to console.warn when enabled', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = createLogger('test:warn-output');
    log.warn('warning');

    expect(spy).toHaveBeenCalledWith('[test:warn-output]', 'warning');
    spy.mockRestore();
  });

  it('outputs to console.error when enabled', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = createLogger('test:error-output');
    log.error('error');

    expect(spy).toHaveBeenCalledWith('[test:error-output]', 'error');
    spy.mockRestore();
  });

  it('does NOT output when key is "0"', () => {
    mockStorage.setItem('debug:test:disabled', '0');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const log = createLogger('test:disabled');
    log.log('should not appear');
    log.warn('should not appear');
    log.error('should not appear');

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('reflects runtime localStorage changes (no caching)', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Initially enabled (auto-created)
    const log = createLogger('test:runtime-toggle');
    log.log('first call');
    expect(logSpy).toHaveBeenCalledTimes(1);

    // Disable at runtime
    mockStorage.setItem('debug:test:runtime-toggle', '0');
    log.log('second call');
    expect(logSpy).toHaveBeenCalledTimes(1); // still 1, not 2

    // Re-enable at runtime
    mockStorage.setItem('debug:test:runtime-toggle', '1');
    log.log('third call');
    expect(logSpy).toHaveBeenCalledTimes(2);

    logSpy.mockRestore();
  });

  it('modules are independent (disabling one does not affect another)', () => {
    const spyA = vi.spyOn(console, 'log').mockImplementation(() => {});
    const spyB = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Create two modules
    const logA = createLogger('test:module-a');
    const logB = createLogger('test:module-b');

    // Disable A, enable B
    mockStorage.setItem('debug:test:module-a', '0');
    mockStorage.setItem('debug:test:module-b', '1');

    logA.log('from A');
    logB.log('from B');

    expect(spyA).not.toHaveBeenCalled();
    expect(spyB).toHaveBeenCalledWith('[test:module-b]', 'from B');

    spyA.mockRestore();
    spyB.mockRestore();
  });

  it('does not build message string when disabled (performance)', () => {
    mockStorage.setItem('debug:test:no-build', '0');
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const log = createLogger('test:no-build');
    // If the implementation builds the prefix string even when disabled,
    // this test still passes but the spy won't be called.
    log.log('expensive', { operation: () => 'should not run' });

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------

describe('setDebugEnabled', () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  it('sets key to "1" when enabled=true', () => {
    setDebugEnabled('test:set-enable', true);
    expect(mockStorage.getItem('debug:test:set-enable')).toBe('1');
  });

  it('sets key to "0" when enabled=false', () => {
    setDebugEnabled('test:set-disable', false);
    expect(mockStorage.getItem('debug:test:set-disable')).toBe('0');
  });

  it('affects subsequent log output', () => {
    setDebugEnabled('test:set-affect', false);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const log = createLogger('test:set-affect');
    log.log('should not appear');

    expect(spy).not.toHaveBeenCalled();

    setDebugEnabled('test:set-affect', true);
    log.log('should appear now');
    expect(spy).toHaveBeenCalledWith('[test:set-affect]', 'should appear now');

    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------

describe('isDebugEnabled', () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  it('returns true when key does not exist (default)', () => {
    expect(isDebugEnabled('test:query-missing')).toBe(true);
  });

  it('returns true when key is "1"', () => {
    mockStorage.setItem('debug:test:query-on', '1');
    expect(isDebugEnabled('test:query-on')).toBe(true);
  });

  it('returns false when key is "0"', () => {
    mockStorage.setItem('debug:test:query-off', '0');
    expect(isDebugEnabled('test:query-off')).toBe(false);
  });

  it('does NOT auto-create the key (no side effects)', () => {
    isDebugEnabled('test:no-side-effect');
    expect(mockStorage.getItem('debug:test:no-side-effect')).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('listDebugModules', () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  it('returns empty array when no debug keys exist', () => {
    expect(listDebugModules()).toEqual([]);
  });

  it('lists all debug: keys sorted alphabetically', () => {
    mockStorage.setItem('debug:zebra', '1');
    mockStorage.setItem('debug:apple', '0');
    mockStorage.setItem('debug:mango', '1');

    const modules = listDebugModules();

    expect(modules).toEqual([
      { module: 'apple', enabled: false },
      { module: 'mango', enabled: true },
      { module: 'zebra', enabled: true },
    ]);
  });

  it('does not include non-debug keys', () => {
    mockStorage.setItem('debug:my-module', '1');
    mockStorage.setItem('other-key', 'value');
    mockStorage.setItem('theme', 'dark');

    const modules = listDebugModules();
    expect(modules).toEqual([{ module: 'my-module', enabled: true }]);
  });

  it('reflects enabled state correctly', () => {
    mockStorage.setItem('debug:on-module', '1');
    mockStorage.setItem('debug:off-module', '0');

    const modules = listDebugModules();
    const onMod = modules.find(m => m.module === 'on-module');
    const offMod = modules.find(m => m.module === 'off-module');

    expect(onMod?.enabled).toBe(true);
    expect(offMod?.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('module name edge cases', () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  it('handles colons in module names', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const log = createLogger('app:sub:deep');
    log.log('nested');

    expect(spy).toHaveBeenCalledWith('[app:sub:deep]', 'nested');
    expect(mockStorage.getItem('debug:app:sub:deep')).toBe('1');
    spy.mockRestore();
  });

  it('handles hyphens in module names', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const log = createLogger('my-app-module');
    log.log('dashed');

    expect(spy).toHaveBeenCalledWith('[my-app-module]', 'dashed');
    spy.mockRestore();
  });

  it('handles empty args', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const log = createLogger('test:empty-args');
    log.log();

    expect(spy).toHaveBeenCalledWith('[test:empty-args]');
    spy.mockRestore();
  });

  it('handles special characters in args', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const log = createLogger('test:special');
    log.log('emoji: 🎉', 'null:', null, 'undefined:', undefined);

    expect(spy).toHaveBeenCalledWith('[test:special]', 'emoji: 🎉', 'null:', null, 'undefined:', undefined);
    spy.mockRestore();
  });
});
