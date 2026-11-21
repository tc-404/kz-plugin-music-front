/** 公开接口访问控制：来源 IP 门禁
 *
 * 咔咔珂的公开路由（/plugin/<id>/api/*）在框架层是免登录、公网可达的，
 * 且框架没有针对插件的"外放 API 开关"。插件无法改宿主的 bind 地址，
 * 因此在 handler 入口按来源 IP 做等效的访问控制：
 *   - listenAddress = 127.0.0.1：只放行本机回环地址
 *   - listenAddress = 0.0.0.0：放行全部；若配置了白名单，则只放行名单内 IP
 *
 * 安全要点：只信 TCP 对端地址（socket.remoteAddress），不信 X-Forwarded-For，
 * 否则攻击者伪造一个头就能绕过"仅本机"限制。
 */

import type { Req } from './types';

/** 从原始 Express 请求里取 TCP 对端 IP，并归一化（去掉 ::ffff: 前缀、IPv6 回环） */
export function clientIp(req: Req): string {
  const raw = (req as any)?.raw;
  let ip = '';
  try {
    ip = String(raw?.socket?.remoteAddress ?? raw?.ip ?? raw?.connection?.remoteAddress ?? '');
  } catch { /* 没有 raw（如自测里的模拟请求）时视为未知来源 */ }
  return normalizeIp(ip);
}

/** 归一化 IP：去端口/区域、去 IPv4-mapped 前缀、IPv6 回环统一成 127.0.0.1 */
export function normalizeIp(ip: string): string {
  let s = String(ip || '').trim().toLowerCase();
  if (!s) return '';
  // 去掉 [IPv6]:port / IPv4:port 形式里的端口（socket.remoteAddress 通常不带端口，这里兜底）
  if (s.startsWith('[')) {
    const close = s.indexOf(']');
    if (close > 0) s = s.slice(1, close);
  } else {
    const lastColon = s.lastIndexOf(':');
    // 仅当形如 IPv4:port 时截断；纯 IPv6 含多个冒号不能截
    if (lastColon > 0 && (s.match(/:/g) || []).length === 1 && /^\d+\.\d+\.\d+\.\d+:\d+$/.test(s)) {
      s = s.slice(0, lastColon);
    }
  }
  // IPv4-mapped IPv6：::ffff:192.168.1.1 -> 192.168.1.1
  if (s.startsWith('::ffff:')) s = s.slice(7);
  // IPv6 回环
  if (s === '::1' || s === '0:0:0:0:0:0:0:1') return '127.0.0.1';
  // 去掉 IPv6 zone id
  const pct = s.indexOf('%');
  if (pct > 0) s = s.slice(0, pct);
  return s;
}

/** 粗略校验 IP 合法性（IPv4 四段 0-255 或含冒号的 IPv6），挡住明显脏数据 */
export function isValidIp(ip: string): boolean {
  const s = normalizeIp(ip);
  if (!s) return false;
  if (s.includes(':')) return /^[0-9a-f:]+$/.test(s) && s.includes(':'); // IPv6（含 :: 压缩）
  const parts = s.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

/** 是否本机/回环地址 */
export function isLoopback(ip: string): boolean {
  const s = normalizeIp(ip);
  return s === '127.0.0.1' || s.startsWith('127.') || s === 'localhost';
}

/** 判断来源 IP 是否允许访问公开接口 */
export function isAccessAllowed(
  req: Req,
  listenAddress: string,
  ipWhitelist: string[] | undefined,
): boolean {
  const addr = String(listenAddress || '127.0.0.1').trim();
  const ip = clientIp(req);

  // 仅本机模式（默认）：非回环来源一律拒绝
  if (addr !== '0.0.0.0') {
    return isLoopback(ip);
  }

  // 全网卡模式：白名单为空则放行所有 IP
  const list = Array.isArray(ipWhitelist)
    ? ipWhitelist.map(normalizeIp).filter(Boolean)
    : [];
  if (list.length === 0) return true;
  // 白名单非空：精确匹配（IPv4-mapped 已归一化，回环也已统一）
  return list.includes(ip);
}

const GLOBAL_WINDOW_MS = 60_000;
const GLOBAL_MAX = 120;
const GLOBAL_BAN_MS = 5 * 60_000;

let globalWindowStart = 0;
let globalWindowCount = 0;
let globalBannedUntil = 0;

export function isPublicIp(ip: string): boolean {
  const s = normalizeIp(ip);
  if (!s || isLoopback(s)) return false;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 10) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false;
    return true;
  }
  if (/^f[cd]/.test(s) || /^fe[89ab]/.test(s)) return false;
  return true;
}

export function isGloballyBanned(ip: string, enabled: boolean): boolean {
  if (!enabled) return false;
  const now = Date.now();
  const publicIp = isPublicIp(ip);
  if (globalBannedUntil > now) return publicIp;
  if (globalBannedUntil && globalBannedUntil <= now) {
    globalBannedUntil = 0;
    globalWindowStart = 0;
    globalWindowCount = 0;
  }
  if (!globalWindowStart || now - globalWindowStart >= GLOBAL_WINDOW_MS) {
    globalWindowStart = now;
    globalWindowCount = 0;
  }
  globalWindowCount += 1;
  if (globalWindowCount > GLOBAL_MAX) {
    globalBannedUntil = now + GLOBAL_BAN_MS;
    return publicIp;
  }
  return false;
}

export function resetGlobalGuard(): void {
  globalWindowStart = 0;
  globalWindowCount = 0;
  globalBannedUntil = 0;
}

export function globalGuardState(): { count: number; banned: boolean; bannedUntil: number } {
  return { count: globalWindowCount, banned: globalBannedUntil > Date.now(), bannedUntil: globalBannedUntil };
}
