# localStorage-logger

Lightweight localStorage-gated debug logger for browser/Node.js modules.

**GitHub**: https://github.com/weijia/localStorage-logger
**NPM**: `@richard432/localstorage-logger`
**设计文档**: [DESIGN.md](./DESIGN.md)

## 安装

```bash
npm install @richard432/localstorage-logger
```

## 快速开始

```typescript
import { createLogger } from '@richard432/localstorage-logger';

const log = createLogger('my-app:auth');

log.log('User logged in', userId);    // [my-app:auth] User logged in 123
log.warn('Token expiring soon');       // [my-app:auth] Token expiring soon
log.error('Auth failed', err);         // [my-app:auth] Auth failed Error(...)
```

## 工作原理

每个模块对应一个 localStorage key `debug:<module-name>`：

- **key 不存在** → 自动创建，值为 `'1'`（默认开启）
- **值为 `'1'`** → 输出日志
- **值为 `'0'`** → 静默

在浏览器控制台中控制：

```javascript
// 关闭某模块
localStorage.setItem('debug:my-app:auth', '0');

// 开启某模块
localStorage.setItem('debug:my-app:auth', '1');
```

## API

| 方法 | 说明 |
|---|---|
| `createLogger(module)` | 工厂函数，返回 `{ log, warn, error }` |
| `setDebugEnabled(module, enabled)` | 程序化开关某模块 |
| `isDebugEnabled(module)` | 查询某模块是否开启（无副作用） |
| `listDebugModules()` | 列出 localStorage 中所有 debug 模块 |

## License

MIT
