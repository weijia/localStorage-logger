# zen-fs-debug-logger — 设计文档

## 1. 背景与问题

zen-fs 生态中（zen-fs-sync、zen-fs-config、zen-fs-config-admin）存在大量 `console.log/warn/error` 调用，这些调用绕过了已有的 logger 机制直接输出到控制台，导致：

1. **无法按模块开关**：所有日志始终输出，无法在生产环境中选择性关闭某个模块的日志
2. **噪音过大**：约 110+ 处裸 console 调用，开发调试时信息淹没，生产环境也无法收敛
3. **logger 形同虚设**：两个包各有 `logger.ts`，但业务代码全部绕过它

### 现状统计

| 包 | 文件 | console 调用数 | 是否走 logger |
|---|---|---|---|
| zen-fs-sync | sync-pair.ts | 29 | 否 |
| zen-fs-sync | utils.ts | 2 | 否 |
| zen-fs-sync | logger.ts | 1 | 是（仅输出口） |
| zen-fs-config | config-repo.ts | ~77 | 否 |
| zen-fs-config | logger.ts | 1 | 是（仅输出口） |

## 2. 设计目标

- **按模块独立控制**：每个模块（如 `zen-fs-sync:sync`、`zen-fs-config`）对应一个 localStorage key，独立开关
- **默认开启**：key 不存在时自动创建并设为 `1`，确保新模块开箱即可看到日志
- **零依赖**：纯 TypeScript，不引入任何运行时依赖
- **浏览器 + Node.js 兼容**：浏览器用 localStorage，Node.js 用环境变量 fallback
- **简单 API**：`createLogger(module)` 返回 `{ log, warn, error }` 三个方法
- **vConsole 友好**：所有输出通过 `console.log/warn/error`，vConsole 可自动捕获

## 3. 核心设计

### 3.1 localStorage Key 规范

```
debug:<module-name>
```

- key 不存在 → 自动创建，值为 `'1'`（默认开启）
- 值为 `'1'` → 输出日志
- 值为 `'0'` → 静默

示例：

| key | 模块 | 默认值 |
|---|---|---|
| `debug:zen-fs-sync:sync` | zen-fs-sync 同步引擎 | `1` |
| `debug:zen-fs-sync:utils` | zen-fs-sync 工具函数 | `1` |
| `debug:zen-fs-config` | zen-fs-config 核心逻辑 | `1` |
| `debug:zen-fs-config:meta` | zen-fs-config 元数据管理 | `1` |

### 3.2 API 设计

```typescript
interface Logger {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

function createLogger(module: string): Logger;
```

#### 使用示例

```typescript
import { createLogger } from 'zen-fs-debug-logger';

const log = createLogger('zen-fs-sync:sync');

log.log('syncBidirectional START', pairId);     // [zen-fs-sync:sync] syncBidirectional START xxx
log.warn('DELETE SKIP', path, err);              // [zen-fs-sync:sync] DELETE SKIP /path Error(...)
log.error('UPDATE FAIL', path, err);             // [zen-fs-sync:sync] UPDATE FAIL /path Error(...)
```

#### 用户控制

在浏览器控制台中：

```javascript
// 关闭某模块日志
localStorage.setItem('debug:zen-fs-sync:sync', '0');

// 开启某模块日志
localStorage.setItem('debug:zen-fs-sync:sync', '1');

// 删除 key，下次访问时自动重建为 '1'（重新开启）
localStorage.removeItem('debug:zen-fs-sync:sync');
```

### 3.3 运行时行为

```
createLogger('zen-fs-sync:sync')
  │
  ├── log/warn/error 被调用
  │     │
  │     ├── 检查 localStorage.getItem('debug:zen-fs-sync:sync')
  │     │     │
  │     │     ├── null → localStorage.setItem(key, '1'), 返回 true
  │     │     ├── '1' → 返回 true
  │     │     └── '0' → 返回 false (静默)
  │     │
  │     ├── true → console.log(`[module]`, ...args)
  │     └── false → return (no-op)
  │
  └── 返回 { log, warn, error }
```

### 3.4 环境兼容

#### 浏览器

直接使用 `localStorage`。

#### Node.js / SSR

`localStorage` 不存在时，回退到环境变量：

```
process.env.DEBUG_<MODULE_NAME>
```

- 环境变量存在且为 `'1'` → 输出
- 环境变量存在且为 `'0'` → 静默
- 环境变量不存在 → **默认输出**（与浏览器行为一致）

模块名中的 `:` 和 `-` 转换为 `_`，全大写：

| 模块名 | 环境变量 |
|---|---|
| `zen-fs-sync:sync` | `DEBUG_ZEN_FS_SYNC_SYNC` |
| `zen-fs-config` | `DEBUG_ZEN_FS_CONFIG` |

#### 判定逻辑

```typescript
function getStorageValue(key: string): string | null {
  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem(key);
  }
  // Node.js fallback
  const envKey = 'DEBUG_' + key.replace(/^debug:/, '').replace(/[:-]/g, '_').toUpperCase();
  return process.env[envKey] ?? null;
}

function setStorageValue(key: string, value: string): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(key, value);
  }
  // Node.js: 环境变量只读，不自动创建
}
```

### 3.5 性能优化

- **惰性检查**：每次 log 调用时才检查 localStorage（不做缓存），确保用户在运行时修改 key 立即生效
- **无开关时不构建字符串**：在 `isEnabled()` 返回 false 时直接 return，不执行模板字符串拼接
- **localStorage 读取开销**：现代浏览器 localStorage.getItem 是同步 O(1) 操作，每次调用开销约 0.01ms，对于日志场景完全可接受

## 4. 完整实现规范

### 4.1 src/index.ts

```typescript
const PREFIX = 'debug:';

/**
 * Check if a module's debug logging is enabled.
 * If the localStorage key doesn't exist, create it with value '1' (default on).
 */
function isEnabled(module: string): boolean {
  const key = `${PREFIX}${module}`;
  let val: string | null = null;

  if (typeof localStorage !== 'undefined') {
    val = localStorage.getItem(key);
    if (val === null) {
      localStorage.setItem(key, '1');
      return true;
    }
  } else if (typeof process !== 'undefined' && process.env) {
    const envKey = 'DEBUG_' + module.replace(/[:-]/g, '_').toUpperCase();
    val = process.env[envKey] ?? null;
    // Node.js: if env var doesn't exist, default to enabled
    if (val === null) return true;
  } else {
    // No storage mechanism available — default to enabled
    return true;
  }

  return val === '1';
}

export interface Logger {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

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
 * Explicitly enable/disable a module's debug logging.
 * Useful for programmatic control (e.g., settings UI).
 */
export function setDebugEnabled(module: string, enabled: boolean): void {
  const key = `${PREFIX}${module}`;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(key, enabled ? '1' : '0');
  }
}

/**
 * Check if a module's debug logging is enabled without side effects
 * (does not auto-create the key if missing).
 */
export function isDebugEnabled(module: string): boolean {
  const key = `${PREFIX}${module}`;
  if (typeof localStorage !== 'undefined') {
    const val = localStorage.getItem(key);
    return val === null ? true : val === '1';
  }
  if (typeof process !== 'undefined' && process.env) {
    const envKey = 'DEBUG_' + module.replace(/[:-]/g, '_').toUpperCase();
    const val = process.env[envKey];
    return val === undefined ? true : val === '1';
  }
  return true;
}

/**
 * List all known debug modules from localStorage.
 */
export function listDebugModules(): { module: string; enabled: boolean }[] {
  const result: { module: string; enabled: boolean }[] = [];
  if (typeof localStorage === 'undefined') return result;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(PREFIX)) {
      const module = key.slice(PREFIX.length);
      result.push({ module, enabled: localStorage.getItem(key) === '1' });
    }
  }
  return result.sort((a, b) => a.module.localeCompare(b.module));
}
```

### 4.2 导出 API 总览

| 导出 | 类型 | 说明 |
|---|---|---|
| `createLogger(module)` | `(module: string) => Logger` | 工厂函数，返回 `{ log, warn, error }` |
| `setDebugEnabled(module, enabled)` | `(module: string, enabled: boolean) => void` | 程序化开关某模块 |
| `isDebugEnabled(module)` | `(module: string) => boolean` | 查询某模块是否开启（无副作用） |
| `listDebugModules()` | `() => { module: string; enabled: boolean }[]` | 列出 localStorage 中所有 debug 模块 |

## 5. 集成计划

### 5.1 zen-fs-sync 集成

**依赖变更**：`package.json` 添加 `zen-fs-debug-logger` 作为 dependency。

**模块划分**：

| 模块名 | 覆盖文件 | 调用数 |
|---|---|---|
| `zen-fs-sync:sync` | sync-pair.ts | 29 |
| `zen-fs-sync:utils` | utils.ts | 2 |

**改动模式**：

```typescript
// 改动前
console.log(`[zen-fs-sync] syncBidirectional comparing source=${n} target=${n}`);

// 改动后
const log = createLogger('zen-fs-sync:sync');
log.log(`syncBidirectional comparing source=${n} target=${n}`);
```

**删除旧 logger.ts**：旧的 `logger.ts`（`setDebug`/`isDebugEnabled`/`createLogger`）完全移除，由 zen-fs-debug-logger 替代。

### 5.2 zen-fs-config 集成

**依赖变更**：`package.json` 添加 `zen-fs-debug-logger` 作为 dependency。

**模块划分**：

| 模块名 | 覆盖文件 | 调用数 |
|---|---|---|
| `zen-fs-config` | config-repo.ts | ~77 |

**改动模式**：与 zen-fs-sync 相同，将 `console.log/warn/error` 替换为 `log.log/warn/error`。

### 5.3 zen-fs-config-admin 集成（vConsole）

**依赖变更**：`package.json` 添加 `vconsole` 作为 dependency。

**改动文件**：`src/components/Layout.tsx`

**设计**：

1. 在底部状态栏（statusbar）增加一个 "Console" 按钮
2. 点击按钮动态 `import('vconsole')` 并初始化
3. vConsole 初始化后自动显示右下角浮动按钮
4. 再次点击按钮可切换 vConsole 面板的显示/隐藏

```typescript
// Layout.tsx 中新增
const [vConsoleLoaded, setVConsoleLoaded] = useState(false);

const toggleVConsole = async () => {
  if (!vConsoleLoaded) {
    const VConsole = (await import('vconsole')).default;
    new VConsole({ theme: 'dark' });
    setVConsoleLoaded(true);
  } else {
    // 切换显示/隐藏
    const el = document.getElementById('__vconsole');
    if (el) {
      el.style.display = el.style.display === 'none' ? '' : 'none';
    }
  }
};

// 在 statusbar 中添加
<button onClick={toggleVConsole}>Console</button>
```

**与日志系统的配合**：

- 模块日志默认开启（key=1），vConsole 中可以看到所有日志
- 用户在 vConsole 的 Console 面板中执行 `localStorage.setItem('debug:zen-fs-sync:sync', '0')` 即可关闭某模块
- vConsole 捕获的是 `console.*` 调用，与 zen-fs-debug-logger 的输出完全兼容

## 6. 测试计划

### 6.1 单元测试

| 测试 | 场景 |
|---|---|
| key 不存在时自动创建并设为 '1' | 模拟 localStorage 为空 |
| key='1' 时输出日志 | 验证 console.log 被调用 |
| key='0' 时不输出日志 | 验证 console.log 不被调用 |
| log/warn/error 分别对应 console.log/warn/error | 验证级别映射 |
| setDebugEnabled 可程序化开关 | 设置 '0' 后 log 不输出 |
| isDebugEnabled 无副作用查询 | 不创建 key |
| listDebugModules 列出所有 debug: 开头的 key | 多模块场景 |
| localStorage 不存在时 fallback 到环境变量 | Node.js 环境 |
| 多模块互不干扰 | 模块 A 关闭不影响模块 B |

### 6.2 集成测试

在 zen-fs-sync 和 zen-fs-config 中替换 console 调用后，运行现有测试套件确保无回归。

## 7. 版本规划

| 版本 | 内容 |
|---|---|
| 0.1.0 | 初始实现：createLogger、setDebugEnabled、isDebugEnabled、listDebugModules |
| 0.2.0 | 集成到 zen-fs-sync 和 zen-fs-config，替换所有裸 console 调用 |
| 0.3.0 | zen-fs-config-admin 集成 vConsole 按钮 |

## 8. 设计决策与权衡

### 为什么用 localStorage 而不是环境变量作为浏览器端的主开关？

- localStorage 在浏览器中持久化，用户设置后刷新页面仍然生效
- 用户可以在 DevTools/vConsole 中随时修改，无需重启应用
- 支持按模块粒度控制，环境变量在浏览器中不易操作

### 为什么默认开启（key 不存在时设为 '1'）？

- 新模块接入后，开发者无需配置即可看到日志
- 生产环境中用户如果觉得吵，可以一键关闭 `localStorage.setItem(key, '0')`
- 相比默认关闭，默认开启更符合"调试工具应该开箱可用"的原则

### 为什么不缓存 isEnabled 结果？

- 用户可能在运行时修改 localStorage，缓存会导致修改不生效
- localStorage.getItem 的性能开销可忽略（~0.01ms）
- 日志调用本身不是热路径，额外一次 getItem 完全可接受

### 为什么 error 级别也受开关控制？

- 用户明确要求"根据这个 key 决定是否输出某条日志"，包括所有级别
- 如果 error 需要始终输出，可以单独创建一个 `zen-fs-debug-logger:error` 模块
- 保持一致的行为比特殊处理 error 更简单可预测

### 为什么不做日志分级（LEVEL）？

- 当前需求只需要 on/off 两种状态
- 分级（DEBUG/INFO/WARN/ERROR）会增加 API 复杂度，且与 localStorage key 的 1/0 模型不匹配
- 如果未来需要分级，可以扩展 key 值为级别数字（如 `debug:module` = `'2'` 表示 WARN 及以上）
