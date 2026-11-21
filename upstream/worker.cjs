/* 音乐服务前置 - Worker 承载器
 *
 * 由 server.cjs 启动，每个实例只承载一个平台的服务。
 * 关键点：worker 内禁止 process.chdir()，所以不切换工作目录，
 * 直接用绝对路径 require 服务入口（三个服务用 __dirname 定位自身资源）。
 */
'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const { platform, cwd, entry, port, dataPath } = workerData;

process.env.PORT = String(port);
process.env.HOST = '127.0.0.1';
process.env.NODE_ENV = 'production';
process.env.CI = '1';

// 屏蔽上游服务的版本检查网络请求与自动打开浏览器（worker 里无意义且拖慢启动）
process.env.NO_UPDATE_CHECK = '1';

// 日志分级：精简模式下拦截上游服务的 console.log。
// 常规请求日志（如酷狗 [OK]）直接丢弃；含错误语义的改走 stderr 以保留（主进程把 stderr 当 warn 转发）。
// 调试模式（KZ_DEBUG_LOG=1）原样输出全部。
if (process.env.KZ_DEBUG_LOG !== '1') {
  const origLog = console.log.bind(console);
  console.log = function (...args) {
    const text = args.map((a) => (typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(' ');
    // 错误识别用带语义的词组，不用裸数字（内部端口 21500 含 "500" 会被误判成错误）。
    // 上游请求错误日志酷狗用 [ERR]，其余多为 error/exception/失败/denied 等词。
    if (/\[ERR\]|\[ERROR\]|\berror\b|\bexception\b|错误|失败|异常|denied|unauthorized|auth-missing/i.test(text)) {
      process.stderr.write('[worker:' + platform + '] ' + text + '\n');
      return;
    }
    if (process.env.KZ_DEBUG_LOG === '1') origLog(...args);
  };
}

// QQ 上游默认用进程内存保存登录会话，重启即丢失（表现就是保存的凭证突然 401 auth-missing）。
// 它有官方的文件持久化开关，这里用插件数据目录里的加密文件开启；密钥单独落盘并复用，
// 保证重启后密钥不变、会话能解回来。文件仅在本地、权限 0600，不随插件包分发。
if (platform === 'qq' && dataPath) {
  try {
    fs.mkdirSync(dataPath, { recursive: true });
    const secretPath = path.join(dataPath, 'qq-session-secret.txt');
    let secret = '';
    try { secret = fs.readFileSync(secretPath, 'utf8').trim(); } catch { /* 首次运行 */ }
    if (!secret) {
      secret = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(secretPath, secret, { encoding: 'utf8', mode: 0o600 });
    }
    process.env.QQ_SESSION_SECRET = secret;
    process.env.QQ_AUTH_SESSION_PATH = path.join(dataPath, 'qq-auth-sessions.json');
  } catch (e) {
    process.stderr.write('[worker:qq] 会话持久化不可用，回退内存模式: ' + (e && e.message || e) + '\n');
  }
}

const entryPath = path.join(cwd, ...entry.split('/'));
try {
  require(entryPath);
  if (parentPort) parentPort.postMessage({ ready: true, platform });
} catch (e) {
  const msg = '[worker:' + platform + '] 加载失败: ' + (e && e.message ? e.message : String(e));
  process.stderr.write(msg + '\n');
  throw e;
}
