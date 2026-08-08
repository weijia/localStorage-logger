/**
 * localStorage-logger — Lightweight localStorage-gated debug logger
 *
 * Each module gets a localStorage key `debug:<module-name>`. If the key
 * doesn't exist, it's auto-created with value '1' (enabled by default).
 * Set to '0' to silence a module.
 */

// Minimal process.env typing for Node.js compatibility without @types/node
declare const process: { env?: Record<string, string | undefined> } | undefined;

const PREFIX = 'debug:';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Check if localStorage is available in the current environment.
 */
function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch {
    return false;
  }
}

/**
 * Get process.env if available (Node.js), otherwise null.
 * Returning the object itself allows TypeScript to narrow the type.
 */
function getProcessEnv(): Record<string, string | undefined> | null {
  try {
    if (typeof process !== 'undefined' && process.env !== undefined) {
      return process.env;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Convert a module name to an environment variable key.
 * e.g. "my-app:sync" → "DEBUG_MY_APP_SYNC"
 */
function moduleToEnvKey(module: string): string {
  return 'DEBUG_' + module.replace(/[:-]/g, '_').toUpperCase();
}

/**
 * Check if a module's debug logging is enabled.
 * If the localStorage key doesn't exist, create it with value '1' (default on).
 */
function isEnabled(module: string): boolean {
  const key = `${PREFIX}${module}`;

  if (hasLocalStorage()) {
    const val = localStorage.getItem(key);
    if (val === null) {
      localStorage.setItem(key, '1');
      return true;
    }
    return val === '1';
  }

  const env = getProcessEnv();
  if (env) {
    const envKey = moduleToEnvKey(module);
    const val = env[envKey];
    if (val === undefined) return true; // default: enabled
    return val === '1';
  }

  // No storage mechanism available — default to enabled
  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface Logger {
  /** Debug/info level log. Maps to console.log. */
  log(...args: unknown[]): void;
  /** Warning level log. Maps to console.warn. */
  warn(...args: unknown[]): void;
  /** Error level log. Maps to console.error. */
  error(...args: unknown[]): void;
}

/**
 * Create a logger for the given module.
 *
 * The module name corresponds to a localStorage key `debug:<module>`.
 * On first access, the key is auto-created with value '1' (enabled).
 * Users can toggle logging via:
 *   localStorage.setItem('debug:my-module', '0')  // disable
 *   localStorage.setItem('debug:my-module', '1')  // enable
 *
 * @example
 * ```typescript
 * import { createLogger } from 'localstorage-logger';
 *
 * const log = createLogger('my-app:auth');
 * log.log('User logged in', userId);    // [my-app:auth] User logged in 123
 * log.warn('Token expiring soon');
 * log.error('Auth failed', err);
 * ```
 */
export function createLogger(module: string): Logger {
  return {
    log(...args: unknown[]): void {
      if (isEnabled(module)) {
        console.log(`[${module}]`, ...args);
      }
    },
    warn(...args: unknown[]): void {
      if (isEnabled(module)) {
        console.warn(`[${module}]`, ...args);
      }
    },
    error(...args: unknown[]): void {
      if (isEnabled(module)) {
        console.error(`[${module}]`, ...args);
      }
    },
  };
}

/**
 * Explicitly enable or disable a module's debug logging.
 * Useful for programmatic control (e.g., settings UI).
 *
 * @example
 * ```typescript
 * setDebugEnabled('my-app:auth', false); // silence auth logs
 * setDebugEnabled('my-app:auth', true);  // re-enable
 * ```
 */
export function setDebugEnabled(module: string, enabled: boolean): void {
  const key = `${PREFIX}${module}`;
  if (hasLocalStorage()) {
    localStorage.setItem(key, enabled ? '1' : '0');
  } else {
    const env = getProcessEnv();
    if (env) {
      env[moduleToEnvKey(module)] = enabled ? '1' : '0';
    }
  }
}

/**
 * Check if a module's debug logging is enabled WITHOUT side effects.
 * Unlike createLogger() which auto-creates the key if missing, this function
 * only reads the current state.
 *
 * @returns true if the module is enabled (or key doesn't exist yet, defaulting to enabled)
 */
export function isDebugEnabled(module: string): boolean {
  const key = `${PREFIX}${module}`;

  if (hasLocalStorage()) {
    const val = localStorage.getItem(key);
    return val === null ? true : val === '1';
  }

  const env = getProcessEnv();
  if (env) {
    const envKey = moduleToEnvKey(module);
    const val = env[envKey];
    return val === undefined ? true : val === '1';
  }

  return true;
}

/**
 * List all known debug modules from localStorage (or process.env in Node.js).
 *
 * @returns Array of { module, enabled } sorted alphabetically by module name.
 */
export function listDebugModules(): { module: string; enabled: boolean }[] {
  const result: { module: string; enabled: boolean }[] = [];

  if (hasLocalStorage()) {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PREFIX)) {
        const module = key.slice(PREFIX.length);
        result.push({ module, enabled: localStorage.getItem(key) === '1' });
      }
    }
  } else {
    const env = getProcessEnv();
    if (env) {
      for (const envKey of Object.keys(env)) {
        if (envKey.startsWith('DEBUG_')) {
          const module = envKey
            .slice('DEBUG_'.length)
            .toLowerCase()
            .replace(/_/g, '-');
          const val = env[envKey];
          result.push({ module, enabled: val === '1' });
        }
      }
    }
  }

  return result.sort((a, b) => a.module.localeCompare(b.module));
}
