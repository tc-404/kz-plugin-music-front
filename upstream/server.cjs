/* 音乐服务前置 - 统一进程入口
 *
 * 一个 OS 进程对外只监听一个端口（默认 9500），内部用三个 Worker Thread
 * 分别承载 QQ / 网易云 / 酷狗服务。每个 worker 有独立的 V8 堆和事件循环，
 * 单个服务崩溃（JS 异常、死循环）不影响另外两个，主线程会自动重启它。
 *
 * 三份服务源码保持完全独立（upstream/qq、upstream/netease、upstream/kugou），
 * 未做任何修改；升级某个平台只需替换对应目录。
 *
 * 特性：
 * - 按 /qq /netease /kugou 前缀剥离后代理到内部端口
 * - worker 崩溃自动重启（带退避与次数上限，防抖动）
 * - 父进程心跳：宿主消失后本进程自杀，杜绝孤儿进程
 * - SIGTERM 优雅关闭：关监听、停心跳、终止全部 worker
 */
'use strict';

const { Worker } = require('node:worker_threads');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const BASE = __dirname;
const PORT = Number(process.env.PORT || 9500);
const HOST = process.env.HOST || '127.0.0.1';
const WORKER_FILE = path.join(BASE, 'worker.cjs');

// 内部回环端口：仅进程内通信，不对外暴露；随对外端口偏移避免多实例冲突
const INTERNAL_BASE = 20000 + (PORT % 1000) * 3;
const PLATFORMS = ['qq', 'netease', 'kugou'];
const defs = {
  qq: { cwd: path.join(BASE, 'qq'), entry: 'dist/src/app.js', port: INTERNAL_BASE },
  netease: { cwd: path.join(BASE, 'netease'), entry: 'app.js', port: INTERNAL_BASE + 1 },
  kugou: { cwd: path.join(BASE, 'kugou'), entry: 'app.js', port: INTERNAL_BASE + 2 },
};

const workers = new Map();
const retries = Object.create(null);
const retryTimers = new Map();
let shuttingDown = false;
let heartbeat = null;
// 活跃代理请求集合：关闭时统一销毁，避免客户端连接悬挂导致句柄/内存泄漏
const activeProxies = new Set();

const DEBUG_LOG = process.env.KZ_DEBUG_LOG === '1';

function log(level, msg) {
  // 精简模式只保留 warn/error；调试模式输出全部（含 worker 启停等 info）
  if (!DEBUG_LOG && level === 'info') return;
  // 统一走 stdout；插件管理器会把它转发到 ctx.logger
  process.stdout.write('[' + level + '] ' + msg + '\n');
}

function startWorker(pf) {
  if (shuttingDown) return;
  const d = defs[pf];
  const w = new Worker(WORKER_FILE, {
    workerData: {
      platform: pf,
      cwd: d.cwd,
      entry: d.entry,
      port: d.port,
      dataPath: process.env.KZ_MUSIC_DATA_PATH || '',
    },
  });
  workers.set(pf, w);
  log('info', 'worker ' + pf + ' 启动 @ 内部端口 ' + d.port);

  let gone = false;
  let watchdog = null;
  const onGone = (reason) => {
    if (gone) return; // error/exit 可能连续触发，只处理一次，避免重复计数与重复重启
    gone = true;
    if (watchdog) { clearTimeout(watchdog); watchdog = null; }
    if (workers.get(pf) === w) workers.delete(pf);
    if (shuttingDown) return;
    retries[pf] = (retries[pf] || 0) + 1;
    if (retries[pf] > 8) {
      log('error', 'worker ' + pf + ' 连续崩溃 ' + retries[pf] + ' 次，暂停自动重启（5 分钟后重置计数重试）');
      // 不永久放弃：定时重置计数后再试一次，避免某平台永久失效
      const resetTimer = setTimeout(() => {
        retryTimers.delete(pf);
        if (shuttingDown) return;
        retries[pf] = 0;
        log('info', 'worker ' + pf + ' 重试计数已重置，重新拉起');
        startWorker(pf);
      }, 5 * 60 * 1000);
      resetTimer.unref();
      retryTimers.set(pf, resetTimer);
      return;
    }
    const delay = Math.min(1000 * retries[pf], 8000);
    log('warn', 'worker ' + pf + ' ' + reason + '，' + delay + 'ms 后第 ' + retries[pf] + ' 次重启');
    const t = setTimeout(() => { retryTimers.delete(pf); startWorker(pf); }, delay);
    retryTimers.set(pf, t);
  };
  // 'error' 与 'exit' 都要处理：某些加载错误只触发 error 不触发后续重启
  w.on('error', (e) => { log('error', 'worker ' + pf + ' 错误: ' + e.message); onGone('error'); });
  w.on('exit', (code) => onGone('退出(code=' + code + ')'));

  // 启动看门狗：上游初始化时可能卡在网络请求（例如注册匿名 token）上既不监听也不退出。
  // 超过 60 秒仍未就绪就终止当前 worker，由 onGone 走退避重启；只作用于当前实例。
  watchdog = setTimeout(async () => {
    if (shuttingDown || gone || workers.get(pf) !== w) return;
    if (await portOpen(d.port)) return;
    if (shuttingDown || gone || workers.get(pf) !== w) return;
    log('warn', 'worker ' + pf + ' 启动超过 60s 未就绪，终止后自动重启');
    try { await w.terminate(); } catch { /* ignore */ }
  }, 60000);
  watchdog.unref();
}

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.createConnection({ host: '127.0.0.1', port });
    const done = (v) => { s.destroy(); resolve(v); };
    s.setTimeout(500);
    s.once('connect', () => done(true));
    s.once('timeout', () => done(false));
    s.once('error', () => done(false));
  });
}

async function waitPort(port, ms = 30000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (await portOpen(port)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

// 统一入口：按路径前缀剥离后代理到对应 worker 的内部端口
const server = http.createServer((req, res) => {
  if (req.url === '/__health' || req.url && req.url.startsWith('/__health?')) {
    const status = {};
    for (const pf of PLATFORMS) {
      const alive = workers.has(pf);
      // worker 存活即视为已从崩溃中恢复，清零重试计数，避免偶发崩溃累积到上限
      if (alive && retries[pf]) retries[pf] = 0;
      status[pf] = { alive, port: defs[pf].port };
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, unified: true, port: PORT, workers: status }));
    return;
  }
  let target = null;
  for (const pf of PLATFORMS) {
    const pre = '/' + pf;
    if (req.url === pre || req.url.startsWith(pre + '/')) {
      target = { port: defs[pf].port, path: req.url.slice(pre.length) || '/' };
      break;
    }
  }
  if (!target) { res.writeHead(404); res.end('no route'); return; }
  const opts = {
    hostname: '127.0.0.1', port: target.port, path: target.path, method: req.method,
    headers: { ...req.headers, host: '127.0.0.1:' + target.port },
  };
  let settled = false;
  const pr = http.request(opts, (pres) => {
    res.writeHead(pres.statusCode, pres.headers);
    pres.pipe(res);
  });
  const cleanup = () => {
    if (!activeProxies.has(pr)) return;
    activeProxies.delete(pr);
    clearTimeout(timer);
  };
  // 单次代理最长 60 秒：防止 worker 卡死时客户端连接永久悬挂（句柄/内存泄漏）
  const timer = setTimeout(() => {
    if (!settled) { settled = true; pr.destroy(new Error('代理超时（60s）')); }
  }, 60000);
  activeProxies.add(pr);
  pr.on('close', cleanup);
  pr.on('error', (e) => {
    cleanup();
    if (settled || res.headersSent || res.writableEnded) return;
    settled = true;
    try { res.writeHead(502); res.end('upstream worker unavailable: ' + e.message); } catch { /* ignore */ }
  });
  // 客户端断开/响应结束时，主动销毁上游请求，避免半开连接堆积
  req.on('aborted', () => { settled = true; try { pr.destroy(); } catch { /* ignore */ } });
  res.on('close', () => { if (!res.writableEnded) { settled = true; try { pr.destroy(); } catch { /* ignore */ } } });
  req.pipe(pr);
});

// 父进程存活检测：IPC 通道断开（宿主意外退出）为主，PID 心跳为兜底。
// 双保险：IPC 'disconnect' 无 PID 复用误判；心跳覆盖 IPC 异常未触发的情况。
function startHeartbeat() {
  const ppid = process.ppid;
  heartbeat = setInterval(() => {
    try { process.kill(ppid, 0); }
    catch (e) {
      if (e && e.code === 'ESRCH') {
        log('warn', '父进程 ' + ppid + ' 已消失，本进程自行退出');
        shutdown();
      }
    }
  }, 3000);
  heartbeat.unref();
}

// IPC 通道：插件以 stdio 'ipc' 启动本进程；宿主进程退出时通道断开立即自杀
process.on('disconnect', () => {
  if (shuttingDown) return;
  log('warn', 'IPC 通道断开（宿主已退出），本进程自行退出');
  shutdown();
});

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
  // 清理所有 worker 重启定时器，避免关闭瞬间又被拉起
  for (const t of retryTimers.values()) { try { clearTimeout(t); } catch { /* ignore */ } }
  retryTimers.clear();
  // 销毁全部活跃代理请求，释放客户端与内部连接句柄
  for (const pr of activeProxies) { try { pr.destroy(); } catch { /* ignore */ } }
  activeProxies.clear();
  // 尝试优雅关闭监听（有活动连接时不强等，随后 process.exit 统一回收）
  try { server.close(); } catch { /* ignore */ }
  for (const w of workers.values()) {
    try { await w.terminate(); } catch { /* ignore */ }
  }
  workers.clear();
  log('info', '统一进程已关闭，定时器/连接/worker 均已释放');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
// 防止未捕获异常导致进程处于半死不活状态：记录后走统一关闭流程
process.on('uncaughtException', (e) => {
  log('error', '未捕获异常: ' + (e && e.message ? e.message : String(e)));
  shutdown();
});

(async () => {
  for (const pf of PLATFORMS) startWorker(pf);
  // 统一入口立即监听：单个 worker 启动慢或卡住（如上游网络请求挂起）不能拖垮另外两个平台。
  // worker 未就绪时代理会短暂返回 502，属正常；看门狗会在超时后终止并自动重启该 worker。
  await new Promise((resolve) => server.listen(PORT, HOST, resolve));
  startHeartbeat();
  log('info', '统一入口已监听 http://' + HOST + ':' + PORT + ' （/qq /netease /kugou）');
  // 后台观测各内部端口就绪情况，仅用于日志，不阻塞代理与监听
  for (const pf of PLATFORMS) {
    const ok = await waitPort(defs[pf].port, 30000);
    log('info', pf + ' 内部端口 ' + defs[pf].port + ': ' + (ok ? '就绪' : '未就绪，等待看门狗重启'));
  }
})().catch((e) => { log('error', '启动失败: ' + (e && e.message ? e.message : String(e))); process.exit(1); });
