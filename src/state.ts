/** 运行时状态：配置、多账号凭证、搜索会话缓存的读写与持久化 */

import fs from 'node:fs';
import path from 'node:path';
import type {
  Account, AccountMap, AccountProfile, Ctx, Credential, Platform,
  PublicAccount, SearchResult, Settings,
} from './types';
import { DEFAULT_SETTINGS, PLATFORMS, PLATFORM_NAMES } from './types';
import { newId } from './util';
import { dlog } from './log';

export const state = {
  ctx: null as unknown as Ctx,
  settings: { ...DEFAULT_SETTINGS, bases: { ...DEFAULT_SETTINGS.bases } } as Settings,
  /** 每平台多账号 */
  accounts: {} as AccountMap,
  /** 搜索会话：sessionId -> 搜索结果 */
  sessions: new Map<string, SearchResult>(),
};

function dataDir(ctx: Ctx): string {
  fs.mkdirSync(ctx.dataPath, { recursive: true });
  return ctx.dataPath;
}

const settingsFile = (ctx: Ctx) => path.join(dataDir(ctx), 'settings.json');
const accountsFile = (ctx: Ctx) => path.join(dataDir(ctx), 'accounts.json');
const legacyCredFile = (ctx: Ctx) => path.join(dataDir(ctx), 'credentials.json');

/** 字符串脱敏：保留头 4 / 尾 4 位 */
export function mask(v: string | undefined): string {
  if (!v) return '';
  const s = String(v);
  if (s.length <= 8) return `${s.slice(0, 2)}***${s.slice(-2)}`;
  return `${s.slice(0, 4)}***${s.slice(-4)}`;
}

/** 把旧版单凭证结构迁移成多账号结构 */
function migrateLegacy(ctx: Ctx): AccountMap {
  try {
    const old = JSON.parse(fs.readFileSync(legacyCredFile(ctx), 'utf-8')) || {};
    const map: AccountMap = {};
    for (const p of PLATFORMS) {
      const c = old[p];
      if (!c || (!c.token && !c.cookie)) continue;
      const now = Date.now();
      map[p] = [{
        id: newId(),
        name: `${PLATFORM_NAMES[p]}账号 1`,
        token: c.token || undefined,
        cookie: c.cookie || undefined,
        userId: c.userId || undefined,
        channel: c.channel || undefined,
        enabled: true,
        isDefault: true,
        createdAt: now,
        updatedAt: c.updatedAt || now,
      }];
    }
    return map;
  } catch { return {}; }
}

export function loadState(ctx: Ctx): void {
  state.ctx = ctx;
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(ctx), 'utf-8'));
    state.settings = {
      bases: { ...DEFAULT_SETTINGS.bases, ...(raw?.bases ?? {}) },
      quality: raw?.quality || DEFAULT_SETTINGS.quality,
      // 老配置没有这两个字段时回落到默认值（默认仅本机访问）
      listenAddress: typeof raw?.listenAddress === 'string' && raw.listenAddress.trim()
        ? raw.listenAddress.trim() : DEFAULT_SETTINGS.listenAddress,
      ipWhitelist: Array.isArray(raw?.ipWhitelist)
        ? raw.ipWhitelist.filter((x: unknown) => typeof x === 'string' && x.trim()).map((x: string) => x.trim())
        : [],
    };
  } catch { /* 首次运行用默认 */ }

  try {
    const raw = JSON.parse(fs.readFileSync(accountsFile(ctx), 'utf-8'));
    state.accounts = raw && typeof raw === 'object' ? raw : {};
  } catch {
    state.accounts = migrateLegacy(ctx);
    if (Object.keys(state.accounts).length) saveAccounts(ctx);
  }

  // 保证每个平台有默认账号（数据被手工改过时自愈）
  for (const p of PLATFORMS) {
    const list = state.accounts[p] ?? [];
    if (list.length && !list.some((a) => a.isDefault && a.enabled)) {
      list.forEach((a) => { a.isDefault = false; });
      list[0].isDefault = true;
    }
  }
  dlog(ctx, `[音乐服务前置] 已加载配置，账号数：${PLATFORMS.map((p) => `${p}=${(state.accounts[p] ?? []).length}`).join(', ')}`);
}

export function saveSettings(ctx: Ctx): void {
  fs.writeFileSync(settingsFile(ctx), JSON.stringify(state.settings, null, 2), 'utf-8');
}

export function saveAccounts(ctx: Ctx): void {
  fs.writeFileSync(accountsFile(ctx), JSON.stringify(state.accounts, null, 2), 'utf-8');
}

export function listAccounts(platform: Platform): Account[] {
  const list = state.accounts[platform] ?? [];
  return [...list].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.createdAt - b.createdAt);
}

/** WebUI 可见的账号信息（凭证脱敏） */
export function publicAccount(a: Account): PublicAccount {
  return {
    id: a.id,
    name: a.name,
    enabled: a.enabled,
    isDefault: a.isDefault,
    hasToken: !!a.token,
    hasCookie: !!a.cookie,
    tokenMask: mask(a.token),
    cookieMask: mask(a.cookie),
    userId: a.userId || '',
    updatedAt: a.updatedAt || a.createdAt,
    profile: a.profile,
  };
}

/** 按优先级返回候选账号：已启用 VIP > 已启用非 VIP > 未启用兜底；同级按默认优先、再按添加时间。
 *  显式 id 时只返回该账号（不做 VIP/启用排序），找不到返回空数组。 */
export function accountCandidates(platform: Platform, id?: string): Account[] {
  const list = state.accounts[platform] ?? [];
  if (id) {
    const one = list.find((a) => a.id === id);
    return one ? [one] : [];
  }
  const key = (a: Account) => ({
    vip: a.enabled && a.profile?.vip === true ? 1 : 0,
    enabled: a.enabled ? 1 : 0,
    isDefault: a.isDefault ? 1 : 0,
    createdAt: a.createdAt,
  });
  return [...list].sort((a, b) => {
    const ka = key(a), kb = key(b);
    if (ka.vip !== kb.vip) return kb.vip - ka.vip;
    if (ka.enabled !== kb.enabled) return kb.enabled - ka.enabled;
    if (ka.isDefault !== kb.isDefault) return kb.isDefault - ka.isDefault;
    return ka.createdAt - kb.createdAt;
  });
}

/** 取用户显式设为默认的账号（不等同于实际优先使用的账号，后者见 getAccount 的 VIP 优先规则） */
export function getDefaultAccount(platform: Platform): Account | undefined {
  const list = state.accounts[platform] ?? [];
  return list.find((a) => a.isDefault && a.enabled) ?? list.find((a) => a.isDefault) ?? list[0];
}

/** 取账号：优先 VIP、再默认、再启用、最后第一个；指定 id 时精确匹配 */
export function getAccount(platform: Platform, id?: string): Account | undefined {
  return accountCandidates(platform, id)[0];
}

/** 取凭证给 provider 使用 */
export function getCredential(platform: Platform, accountId?: string): Credential | undefined {
  const a = getAccount(platform, accountId);
  if (!a) return undefined;
  return {
    token: a.token, cookie: a.cookie, userId: a.userId,
    channel: a.channel, updatedAt: a.updatedAt,
  };
}

/** 新增账号；若凭证与已有账号相同则更新该账号（避免扫码重复插入） */
export function addAccount(platform: Platform, cred: Credential, name?: string): Account {
  const list = state.accounts[platform] ?? (state.accounts[platform] = []);
  const key = `${cred.token || ''}|${cred.cookie || ''}|${cred.userId || ''}`;
  const dup = list.find((a) => `${a.token || ''}|${a.cookie || ''}|${a.userId || ''}` === key && key !== '||');
  const now = Date.now();
  if (dup) {
    dup.token = cred.token || dup.token;
    dup.cookie = cred.cookie || dup.cookie;
    dup.userId = cred.userId || dup.userId;
    dup.channel = cred.channel || dup.channel;
    dup.name = name?.trim() || dup.name;
    dup.enabled = true;
    dup.updatedAt = now;
    delete dup.qrKey;
    saveAccounts(state.ctx);
    return dup;
  }
  const acc: Account = {
    id: newId(),
    name: name?.trim() || `${PLATFORM_NAMES[platform]}账号 ${list.length + 1}`,
    token: cred.token || undefined,
    cookie: cred.cookie || undefined,
    userId: cred.userId || undefined,
    channel: cred.channel || undefined,
    enabled: true,
    isDefault: list.length === 0,
    createdAt: now,
    updatedAt: now,
  };
  list.push(acc);
  saveAccounts(state.ctx);
  return acc;
}

function findAccount(platform: Platform, id: string): Account | undefined {
  return (state.accounts[platform] ?? []).find((a) => a.id === id);
}

export function patchAccount(platform: Platform, id: string, patch: { name?: string; enabled?: boolean }): Account | undefined {
  const a = findAccount(platform, id);
  if (!a) return undefined;
  if (typeof patch.name === 'string' && patch.name.trim()) a.name = patch.name.trim().slice(0, 40);
  if (typeof patch.enabled === 'boolean') {
    a.enabled = patch.enabled;
    if (!a.enabled && a.isDefault) {
      const next = (state.accounts[platform] ?? []).find((x) => x.id !== id && x.enabled);
      if (next) { next.isDefault = true; a.isDefault = false; }
    }
  }
  a.updatedAt = Date.now();
  saveAccounts(state.ctx);
  return a;
}

export function setDefaultAccount(platform: Platform, id: string): boolean {
  const list = state.accounts[platform] ?? [];
  const target = list.find((a) => a.id === id);
  if (!target) return false;
  list.forEach((a) => { a.isDefault = a.id === id; });
  saveAccounts(state.ctx);
  return true;
}

export function removeAccount(platform: Platform, id: string): boolean {
  const list = state.accounts[platform] ?? [];
  const idx = list.findIndex((a) => a.id === id);
  if (idx < 0) return false;
  const wasDefault = list[idx].isDefault;
  list.splice(idx, 1);
  if (wasDefault && list.length) {
    (list.find((a) => a.enabled) ?? list[0]).isDefault = true;
  }
  saveAccounts(state.ctx);
  return true;
}

/** 刷新凭证后写回指定账号 */
export function updateAccountCredential(platform: Platform, id: string, cred: Credential): Account | undefined {
  const a = findAccount(platform, id);
  if (!a) return undefined;
  a.token = cred.token ?? a.token;
  a.cookie = cred.cookie ?? a.cookie;
  a.userId = cred.userId ?? a.userId;
  a.channel = cred.channel ?? a.channel;
  a.updatedAt = Date.now();
  delete a.qrKey;
  saveAccounts(state.ctx);
  return a;
}

export function setAccountProfile(platform: Platform, id: string, profile: AccountProfile): void {
  const a = findAccount(platform, id);
  if (!a) return;
  a.profile = { ...profile, checkedAt: Date.now() };
  saveAccounts(state.ctx);
}

/** 新建搜索会话 */
export function cacheSearch(result: Omit<SearchResult, 'sessionId'>): SearchResult {
  const sessionId = newId();
  const full: SearchResult = { ...result, sessionId, createdAt: Date.now() };
  if (state.sessions.size >= 200) {
    const oldest = state.sessions.keys().next().value;
    if (oldest) state.sessions.delete(oldest);
  }
  state.sessions.set(sessionId, full);
  return full;
}

export function getSession(sessionId: string): SearchResult | undefined {
  return state.sessions.get(sessionId);
}
