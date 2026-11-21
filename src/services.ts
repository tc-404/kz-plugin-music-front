/** 内置上游服务管理器（统一进程版）
 *
 * 架构：一个 Node 进程（upstream/server.cjs）对外监听统一端口 9500，
 * 内部用三个 Worker Thread 分别承载 QQ / 网易云 / 酷狗服务，各自独立 V8 堆。
 * 单个服务崩溃只重启对应 worker，不影响另外两个。
 *
 * 三份服务源码完全独立（upstream/<平台>/），未做任何修改，便于单独升级。
 *
 * 设计要点：
 * - 各平台的默认地址是统一端口 + 平台前缀（如 http://127.0.0.1:9500/qq），
 *   由统一进程按前缀代理到内部 worker。
 * - 只有当各平台地址都是本机统一地址时才接管统一进程；若某平台被改成外部
 *   地址，则该平台由插件直连外部，但统一进程仍可为其余内置平台服务。
 * - 统一进程带父进程心跳，宿主消失会自杀；plugin_cleanup 走 SIGTERM 优雅关闭。
 */

import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import type { Ctx, Platform } from './types';
import { DEFAULT_BASES } from './types';
import { dlog, klog, isDebugLog } from './log';

interface ManagedProc {
  proc: ChildProcess;
  port: number;
}

let managed: ManagedProc | null = null;
/** cleanup 已请求：阻止启动流程继续拉起进程（避免卸载后残留孤儿） */
let stopping = false;
/** 正在进行的启动流程，cleanup 会等待它收尾 */
let starting: Promise<void> | null = null;

const PLATFORMS: Platform[] = ['qq', 'netease', 'kugou'];
const UNIFIED_PORT = 9500;

/** 等待子进程真正退出；超时则 SIGKILL 兜底，防止进程残留占端口/内存 */
function terminateProc(proc: ChildProcess): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* ignore */ }
      finish();
    }, 5000);
    proc.once('exit', finish);
    try { proc.kill('SIGTERM'); } catch { finish(); }
  });
}

/** 统一入口的 origin（三平台默认地址应共享同一 origin） */
function unifiedOrigin(): string {
  try { return new URL(DEFAULT_BASES.qq).origin; }
  catch { return 'http://127.0.0.1:9500'; }
}

/** 判断平台地址是否指向本机内置统一服务（origin 一致，路径为空或 /<platform>） */
function isLocalUnified(base: string, platform: Platform): boolean {
  try {
    const u = new URL(base.trim());
    if (u.origin !== unifiedOrigin()) return false;
    const pathPart = u.pathname.replace(/\/$/, '');
    return pathPart === '' || pathPart === '/' + platform;
  } catch { return false; }
}

function portOpen(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (v: boolean) => { socket.destroy(); resolve(v); };
    socket.setTimeout(800);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

function waitForPort(port: number, timeoutMs = 30000, aborted?: () => boolean): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (v: boolean) => { if (timer) clearTimeout(timer); resolve(v); };
    const tick = async () => {
      if (aborted?.()) return finish(false);
      if (await portOpen(port)) return finish(true);
      if (Date.now() - start >= timeoutMs) return finish(false);
      timer = setTimeout(tick, 400);
    };
    void tick();
  });
}

/** 启动统一进程（至少一个平台使用内置地址时）——内部实现 */
async function doStart(ctx: Ctx): Promise<void> {
  stopping = false;
  const { state } = await import('./state');
  if (stopping) return;
  const anyInternal = PLATFORMS.some((p) => {
    const base = state.settings.bases[p] || DEFAULT_BASES[p];
    return isLocalUnified(base, p);
  });
  if (!anyInternal) {
    dlog(ctx, '[内置服务] 三个平台都配置了外部地址，跳过内置统一进程');
    return;
  }

  // 端口已开：探活确认是我们自己的统一进程再复用，避免误占第三方服务
  if (await portOpen(UNIFIED_PORT)) {
    if (stopping) return;
    const ours = await isOurUnified();
    dlog(ctx,
      `[内置服务] 统一端口 ${UNIFIED_PORT} 已被占用，${ours ? '复用现有服务' : '非本插件服务，不接管'}`,
    );
    return;
  }
  if (stopping) return;

  const entry = path.join(ctx.pluginPath, 'upstream', 'server.cjs');
  if (!fs.existsSync(entry)) {
    ctx.logger.warn(`[内置服务] 统一入口不存在：${entry}`);
    return;
  }

  dlog(ctx, `[内置服务] 启动统一进程（三 Worker）：${entry} @ ${UNIFIED_PORT}`);
  let proc: ChildProcess;
  try {
    // stdio 增加 'ipc'：宿主（咔咔珂）意外退出时 IPC 通道断开，
    // 统一进程的 'disconnect' 事件会立即自杀，比 PID 心跳更可靠、无 PID 复用误判。
    // 上游日志仍走 pipe 转发到 ctx.logger。
    proc = spawn(process.execPath, [entry], {
      cwd: path.join(ctx.pluginPath, 'upstream'),
      // 把插件数据目录传给统一进程：QQ 上游的登录态是进程内会话表，重启即失效，
      // worker 会用这个目录持久化加密会话，避免重启后已保存的 QQ 凭证变成 401。
      env: { ...process.env, PORT: String(UNIFIED_PORT), KZ_MUSIC_DATA_PATH: ctx.dataPath, KZ_DEBUG_LOG: isDebugLog() ? '1' : '0' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    });
  } catch (e) {
    ctx.logger.error(`[内置服务] 统一进程启动异常：${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  const pipe = (chunk: Buffer, level: 'info' | 'warn') => {
    // 精简模式丢弃上游 stdout 的 info（请求日志、常规提示），stderr 的 warn/error 始终保留。
    if (level === 'info' && !isDebugLog()) return;
    const s = chunk.toString().trim().split('\n').slice(-2).join(' | ').slice(0, 400);
    if (s) ctx.logger[level](`[upstream] ${s}`);
  };
  proc.stdout?.on('data', (c: Buffer) => pipe(c, 'info'));
  proc.stderr?.on('data', (c: Buffer) => pipe(c, 'warn'));
  proc.once('error', (e) => ctx.logger.error(`[内置服务] 统一进程错误：${e.message}`));
  proc.once('exit', (code, signal) => {
    managed = null;
    const tag = `${code === null ? '' : ' code=' + code}${signal ? ' signal=' + signal : ''}`;
    // 主动关闭（卸载/重载）或优雅退出都属预期，精简模式静默；非正常退出才报 warn。
    if (stopping || code === 0) dlog(ctx, `[内置服务] 统一进程退出（预期内）${tag}`);
    else ctx.logger.warn(`[内置服务] 统一进程意外退出，${tag}`);
  });
  managed = { proc, port: UNIFIED_PORT };

  // 启动竞态：若在等待就绪期间收到 cleanup，立即终止，绝不留下无人管理的进程
  if (stopping) {
    await terminateProc(proc);
    managed = null;
    return;
  }

  const ok = await waitForPort(UNIFIED_PORT, 30000, () => stopping);
  if (stopping) {
    await terminateProc(proc);
    managed = null;
    return;
  }
  if (!ok) {
    ctx.logger.error(`[内置服务] 统一端口 ${UNIFIED_PORT} 在 30 秒内未就绪`);
    await terminateProc(proc);
    managed = null;
    return;
  }
  klog(ctx, `[内置服务] 统一进程就绪 @ http://127.0.0.1:${UNIFIED_PORT}（/qq /netease /kugou）`);
}

/** 对外启动入口：追踪启动 Promise，cleanup 可等待其收尾，杜绝卸载竞态 */
export function startAllServices(ctx: Ctx): Promise<void> {
  const p = doStart(ctx).catch((e) => {
    ctx.logger.error(`[内置服务] 启动流程异常：${e instanceof Error ? e.message : String(e)}`);
  });
  starting = p;
  void p.then(() => { if (starting === p) starting = null; });
  return p;
}

/** 探测占用端口的服务是否为本插件统一进程（/__health 带 unified 标记） */
async function isOurUnified(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      const resp = await fetch(`http://127.0.0.1:${UNIFIED_PORT}/__health`, { signal: controller.signal });
      if (!resp.ok) return false;
      const body = await resp.json() as { unified?: boolean; service?: string };
      return body?.unified === true;
    } finally {
      clearTimeout(timer);
    }
  } catch { return false; }
}

/** 优雅关闭统一进程：等待真正退出（含超时兜底），释放端口与内存 */
export async function stopAllServices(ctx: Ctx): Promise<void> {
  stopping = true;
  // 等待仍在进行的启动流程收尾，避免"卸载后又冒出一个进程"
  if (starting) {
    try { await starting; } catch { /* ignore */ }
  }
  if (!managed) return;
  const proc = managed.proc;
  managed = null;
  await terminateProc(proc);
  klog(ctx, '[内置服务] 已关闭统一进程并释放端口');
}

/** 供 WebUI / 公开接口查询内置服务运行状态 */
export function serviceStatus(): Record<Platform, { managed: boolean; port: number }> {
  const out = {} as Record<Platform, { managed: boolean; port: number }>;
  for (const p of PLATFORMS) {
    out[p] = { managed: !!managed, port: UNIFIED_PORT };
  }
  return out;
}
