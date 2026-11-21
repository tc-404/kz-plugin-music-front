/** 通用工具：HTTP 请求、字段提取、凭证转 header、日志脱敏 */

import type { Credential } from './types';

/** 带超时的 fetch JSON，返回 undefined 表示失败（由调用方决定如何报错） */
export async function fetchJson(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; timeoutMs?: number; body?: string } = {},
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 12000);
  try {
    const resp = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: { Accept: 'application/json', ...(opts.headers ?? {}) },
      body: opts.body,
      signal: controller.signal,
    });
    const text = await resp.text();
    let data: any;
    try { data = text ? JSON.parse(text) : undefined; } catch { data = undefined; }
    if (!resp.ok) {
      return { __httpError: resp.status, __body: data ?? text?.slice(0, 200) };
    }
    // 部分上游（如酷狗扫码）把凭证放在 Set-Cookie 头而非响应体里。
    // 把 set-cookie 作为非枚举的元信息挂到返回对象上，供需要的 provider 读取，
    // 不影响其他调用方（普通 JSON.parse 对象照常使用）。
    const setCookie = resp.headers?.get?.('set-cookie');
    if (setCookie && data && typeof data === 'object' && !Array.isArray(data)) {
      try { Object.defineProperty(data, '__setCookie', { value: setCookie, enumerable: false, configurable: true }); } catch { /* ignore */ }
    }
    return data ?? text;
  } catch (err) {
    return { __error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** 判断上游响应是否异常 */
export function isUpstreamError(data: any): boolean {
  return !!data && typeof data === 'object' && ('__error' in data || '__httpError' in data);
}

export function upstreamErrorMsg(data: any): string {
  if (!data || typeof data !== 'object') return '上游返回异常';
  if ('__error' in data) return `请求失败：${data.__error}`;
  if ('__httpError' in data) return `上游 HTTP ${data.__httpError}：${JSON.stringify(data.__body ?? '')}`;
  return '上游返回异常';
}

/** 宽松取字段：从多个候选 key 中取第一个非空值。
 *  支持点号路径（如 'result.songs'、'data.lists'）逐层下钻。 */
export function pick(obj: any, keys: string[], fallback: any = ''): any {
  if (!obj || typeof obj !== 'object') return fallback;
  for (const k of keys) {
    let v: any = obj;
    for (const seg of k.split('.')) {
      if (v === undefined || v === null || typeof v !== 'object') { v = undefined; break; }
      v = v[seg];
    }
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return fallback;
}

/** 数组里取第一个非空字段 */
export function firstText(arr: any, keys: string[] = ['name', 'title', 'nickname']): string {
  if (!Array.isArray(arr)) return '';
  for (const item of arr) {
    const v = pick(item, keys, '');
    if (v) return String(v);
  }
  return '';
}

/** 秒数归一化：上游可能给毫秒或字符串 */
export function toSeconds(v: any): number {
  if (v === undefined || v === null || v === '') return 0;
  let n = Number(v);
  if (!Number.isFinite(n)) return 0;
  // 毫秒级（大于 100000，约 27 小时以上的秒数不存在）视为毫秒
  if (n > 100000) n = Math.round(n / 1000);
  return Math.max(0, Math.round(n));
}

/** 凭证 → 各平台 HTTP 头 / query。三平台传凭证方式不同：
 *  - QQ(yakult)：stored 会话在服务端内存，token 为 sealed 时用 query token / Authorization
 *  - 网易云：cookie 走 query cookie 参数
 *  - 酷狗：token + userid 走 Authorization 头 `token=xxx;userid=xxx`
 */
export function credToHeaders(platform: string, cred: Credential | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!cred) return headers;
  if (platform === 'kugou') {
    if (cred.token || cred.userId) {
      const parts: string[] = [];
      if (cred.token) parts.push(`token=${cred.token}`);
      if (cred.userId) parts.push(`userid=${cred.userId}`);
      headers['Authorization'] = parts.join(';');
    }
    if (cred.cookie) headers['Cookie'] = cred.cookie;
  } else if (platform === 'netease') {
    if (cred.cookie) headers['Cookie'] = cred.cookie;
    if (cred.token) headers['Authorization'] = `Bearer ${cred.token}`;
  } else {
    // QQ（yakult-green-tea/qq-music-api）：上游只认 x-qq-session 头或
    // cookie 里的 qqmusic_session。Bearer Authorization 上游不识别。
    if (cred.token) {
      headers['x-qq-session'] = cred.token;
      // 同时给出标准 Cookie 形式，兼容从 cookie 读取的实现
      headers['Cookie'] = `qqmusic_session=${cred.token}${cred.cookie ? '; ' + cred.cookie : ''}`;
    } else if (cred.cookie) {
      headers['Cookie'] = cred.cookie;
    }
  }
  return headers;
}

/** 凭证 → query 参数（网易云 cookie、QQ token 走 query 更稳妥） */
export function credToQuery(platform: string, cred: Credential | undefined): Record<string, string> {
  const q: Record<string, string> = {};
  if (!cred) return q;
  if (platform === 'netease' && cred.cookie) q.cookie = cred.cookie;
  // QQ 上游从 ?cookie=qqmusic_session=xxx 解析会话（query.token 不被识别）
  if (platform === 'qq' && cred.token) q.cookie = `qqmusic_session=${cred.token}`;
  return q;
}

/** 拼接 URL 并附加 query */
export function buildUrl(base: string, pathname: string, query: Record<string, string | number | undefined>): string {
  const u = new URL(pathname.replace(/^\//, ''), base.replace(/\/?$/, '/'));
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  }
  return u.toString();
}

/** 生成短会话 id */
export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 从 cookie 字符串中解析指定 key 的值。
 * QQ 上游扫码成功后，token 藏在 `qqmusic_session=xxx` 里而非独立字段，
 * 必须解析出来才能用于后续登录态探测与取直链。
 */
export function cookieValue(cookie: string | undefined, name: string): string {
  if (!cookie) return '';
  for (const part of String(cookie).split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

/**
 * 从任意嵌套的上游响应中提取可播放直链。
 *
 * 背景：三家上游的直链字段层级不一，且 QQ 的 playUrl 是
 * `{ data: { playUrl: { <songmid>: { url, error, restriction } } } }`——
 * 用浅层 pick 会把整个对象取出来，String() 后前端就显示 `[object Object]`。
 *
 * 策略：深度优先遍历，收集所有字符串形态的 url 候选；优先返回带
 * http(s) 协议、且所在对象没有 error/restriction 标记的可用链接。
 */
export function findPlayableUrl(root: any, songId?: string): string {
  const candidates: { url: string; usable: boolean }[] = [];
  const noise = new Set(['error', 'restriction', 'hint', 'message', 'msg', 'reason', 'cover', 'pic', 'image', 'artwork', 'avatar']);

  const visit = (node: any, parentNoise = false, urlKey = false) => {
    if (candidates.length > 64) return; // 防止异常巨型响应导致长时间遍历
    // 数组元素本身可能是直链（酷狗 /song/url 返回 url: ["http://...", ...]），
    // 此时由父级的 key（url / backupUrl）判定，不能再无条件 return。
    if (typeof node === 'string') {
      if (urlKey && /^https?:\/\//i.test(node.trim())) {
        candidates.push({ url: node.trim(), usable: !parentNoise });
      }
      return;
    }
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const v of node) visit(v, parentNoise, urlKey);
      return;
    }
    // 先尝试按歌曲 id 精确匹配的分支
    if (songId && node[songId] !== undefined) visit(node[songId], parentNoise);
    const entryUsable = !parentNoise && !node.error && !node.restriction;
    for (const [k, v] of Object.entries(node)) {
      if (noise.has(k)) continue;
      const looksUrl = /url|link|play|src|path|media/i.test(k);
      if (typeof v === 'string' && looksUrl && /^https?:\/\//i.test(v.trim())) {
        candidates.push({ url: v.trim(), usable: entryUsable });
      } else if (Array.isArray(v) && looksUrl) {
        // 直链数组：逐项收集，避免 String(array) 变成 "url1,url2" 的无效地址
        for (const item of v) visit(item, !entryUsable, true);
      } else if (v && typeof v === 'object') {
        visit(v, !entryUsable, looksUrl);
      }
    }
  };
  visit(root);

  // 优先返回标记可用的链接；都不可用时，返回一个非空链接让前端至少能看到地址
  const usable = candidates.find((c) => c.usable);
  return usable?.url || candidates[0]?.url || '';
}
