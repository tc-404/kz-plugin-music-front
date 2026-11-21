/** 音乐服务前置（kz-plugin-music-front）
 *
 * 扩展插件：不绑连接、不收消息、只有总开关。
 *   1. 公开路由（getNoAuth）——搜索列表 + 按序号取精准内容，其他插件/用户可访问；
 *   2. WebUI 后台——每个平台独立页面、多账号登录管理、搜索测试、接口文档；
 *   3. 定时刷新每个账号的凭证，cleanup 清理定时器与会话。
 */

import type { Credential, Ctx, Handler, Platform, Req, Res } from './types';
import { clientIp, isAccessAllowed, isGloballyBanned, isValidIp, normalizeIp, resetGlobalGuard, globalGuardState } from './access';
import { PLATFORMS, PLATFORM_NAMES } from './types';
import { PROVIDERS } from './providers';
import { probeStatus } from './providers/status';
import { startAllServices, stopAllServices, serviceStatus } from './services';
import { dlog, klog } from './log';
import {
  addAccount, accountCandidates, cacheSearch, getAccount, getDefaultAccount, getCredential, getSession, listAccounts, loadState,
  patchAccount, publicAccount, removeAccount, saveSettings, setAccountProfile,
  setDefaultAccount, state, updateAccountCredential,
} from './state';

function ok(res: Res, data: unknown): void { res.json({ code: 0, data }); }
function fail(res: Res, code: number, message: string): void { res.json({ code, message }); }

/** 公开接口入口门禁：按监听地址/IP 白名单放行；被拒绝返回 false 并已写出响应 */
function publicGuard(req: Req, res: Res): boolean {
  const allNic = state.settings.listenAddress === '0.0.0.0';
  if (isGloballyBanned(clientIp(req), allNic)) {
    res.status(429).json({ code: -429, message: '请求量已达上限，公网访问被临时封禁 5 分钟' });
    return false;
  }
  if (isAccessAllowed(req, state.settings.listenAddress, state.settings.ipWhitelist)) return true;
  res.status(403).json({ code: -403, message: '访问被拒绝：当前接口仅允许本机或白名单 IP 访问' });
  return false;
}

/** 把账号转成上游凭证（Account 是 Credential 的超集，这里只挑凭证字段） */
function credOf(acc: ReturnType<typeof getAccount>): Credential | undefined {
  if (!acc) return undefined;
  return {
    token: acc.token, cookie: acc.cookie, userId: acc.userId,
    channel: acc.channel, updatedAt: acc.updatedAt,
  };
}

function getPlatform(req: Req): Platform | undefined {
  const p = String(req.query?.platform ?? req.params?.platform ?? '').toLowerCase();
  return (PLATFORMS as string[]).includes(p) ? (p as Platform) : undefined;
}

/** body 里取 platform（兼容只放 body 的调用） */
function bodyPlatform(req: Req): Platform | undefined {
  const p = String((req.body as any)?.platform ?? '').toLowerCase();
  return (PLATFORMS as string[]).includes(p) ? (p as Platform) : undefined;
}
function reqPlatform(req: Req): Platform | undefined { return getPlatform(req) ?? bodyPlatform(req); }

function q(req: Req, key: string): string {
  const v = req.query?.[key];
  return v === undefined || v === null ? '' : String(v);
}
function b(req: Req, key: string): string {
  const v = (req.body as any)?.[key];
  return v === undefined || v === null ? '' : String(v);
}
function num(req: Req, key: string, def: number): number {
  const v = Number(q(req, key));
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : def;
}

/** 待扫码的 key -> 元信息（内存态，不落盘） */
const pendingQr = new Map<string, { platform: Platform; channel: string; name: string; at: number }>();

/** 登录成功后自动探测一次账号资料（昵称/头像/VIP），存回账号供后台展示。
 *  失败静默、不阻塞登录流程——探测不到只是暂时不显示昵称，不影响听歌。 */
async function autoProbe(platform: Platform, id: string): Promise<ReturnType<typeof publicAccount> | undefined> {
  try {
    const cred = getCredential(platform, id);
    if (!cred) return undefined;
    const probe = await probeStatus(platform, state.settings.bases[platform], cred);
    if (probe.found && probe.profile) setAccountProfile(platform, id, probe.profile);
    const acc = getAccount(platform, id);
    return acc ? publicAccount(acc) : undefined;
  } catch {
    const acc = getAccount(platform, id);
    return acc ? publicAccount(acc) : undefined;
  }
}

// ───────────────────────── 公开数据路由（免登录） ─────────────────────────

/** GET /plugin/<id>/api/search?platform=qq&keyword=周杰伦&page=1&limit=20&accountId=xxx */
const publicSearch: Handler = async (req, res) => {
  if (!publicGuard(req, res)) return;
  const platform = getPlatform(req);
  const keyword = q(req, 'keyword').trim();
  if (!platform) return fail(res, -1, `platform 必须是 ${PLATFORMS.join(' / ')}`);
  if (!keyword) return fail(res, -1, 'keyword 不能为空');

  const accountId = q(req, 'accountId') || undefined;
  const candidates = accountCandidates(platform, accountId);
  if (accountId && !candidates.length) return fail(res, -1, 'accountId 不存在');
  const page = num(req, 'page', 1);
  const limit = Math.min(num(req, 'limit', 20), 50);
  let lastErr: unknown;
  for (const acc of candidates) {
    try {
      const { total, songs } = await PROVIDERS[platform].search(
        state.settings.bases[platform], keyword, page, limit, credOf(acc),
      );
      return ok(res, cacheSearch({
        platform, keyword, page, total, list: songs,
        accountId: acc.id, accountName: acc.name,
      }));
    } catch (e) {
      lastErr = e;
      if (accountId) break; // 显式指定账号时不轮换
    }
  }
  fail(res, -2, lastErr instanceof Error ? lastErr.message : String(lastErr || '搜索失败'));
};

/** GET /plugin/<id>/api/pick?sessionId=xxx&seq=1&quality=320
 *  也支持直接 platform + id（跳过会话） */
const publicPick: Handler = async (req, res) => {
  if (!publicGuard(req, res)) return;
  let platform = getPlatform(req);
  let id = q(req, 'id');
  const seq = num(req, 'seq', 0);
  let accountId = q(req, 'accountId') || undefined;
  let title = '', artist = '', album = '', cover = '', duration = 0;

  const sessionId = q(req, 'sessionId');
  if (sessionId) {
    const session = getSession(sessionId);
    if (!session) return fail(res, -1, '会话不存在或已过期，请重新搜索');
    const song = session.list.find((s) => s.seq === seq);
    if (!song) return fail(res, -1, `序号 ${seq} 不在搜索列表中（共 ${session.list.length} 条）`);
    platform = session.platform;
    id = song.id;
    accountId = session.accountId ?? accountId;
    title = song.title; artist = song.artist; album = song.album;
    cover = song.cover; duration = song.duration;
  }
  if (!platform) return fail(res, -1, '缺少 platform');
  if (!id) return fail(res, -1, '缺少 id 或有效的 sessionId+seq');

  const quality = q(req, 'quality') || state.settings.quality;
  const explicit = !!q(req, 'accountId');
  const candidates = accountCandidates(platform, accountId);
  let lastErr: unknown;
  for (const acc of candidates) {
    try {
      const { url, quality: realQuality } = await PROVIDERS[platform].getUrl(
        state.settings.bases[platform],
        { seq: seq || 0, id, title, artist, album, cover, duration },
        quality,
        credOf(acc),
      );
      return ok(res, {
        platform, seq, id, title: title || id, artist, album, cover, duration,
        url, quality: realQuality,
        accountId: acc.id, accountName: acc.name,
      });
    } catch (e) {
      lastErr = e;
      if (explicit) break; // 请求里显式指定账号时不轮换
    }
  }
  fail(res, -2, lastErr instanceof Error ? lastErr.message : String(lastErr || '取直链失败'));
};

/** GET /plugin/<id>/api/platforms —— 平台、地址、账号概览（不含凭证） */
const publicPlatforms: Handler = async (req, res) => {
  if (!publicGuard(req, res)) return;
  ok(res, PLATFORMS.map((p) => {
    const list = listAccounts(p);
    const def = getDefaultAccount(p);
    return {
      platform: p,
      name: PLATFORM_NAMES[p],
      base: state.settings.bases[p],
      loggedIn: !!def && !!(def.token || def.cookie),
      accountCount: list.length,
      defaultAccount: def ? { id: def.id, name: def.name } : null,
    };
  }));
};

const publicHealth: Handler = async (req, res) => {
  if (!publicGuard(req, res)) return;
  ok(res, {
    ok: true, service: 'kz-plugin-music-front', at: new Date().toISOString(),
    builtinServices: serviceStatus(),
  });
};

// ───────────────────────── WebUI 路由（需登录） ─────────────────────────

/** GET /settings —— 配置 + 三平台账号（脱敏） */
const adminGetSettings: Handler = async (_req, res) => {
  ok(res, {
    settings: state.settings,
    api: {
      pluginId: state.ctx.pluginName,
      adminBase: `/api/Plugin/ext/${state.ctx.pluginName}`,
      publicBase: `/plugin/${state.ctx.pluginName}/api`,
    },
    platforms: PLATFORMS.map((p) => ({
      platform: p,
      name: PLATFORM_NAMES[p],
      base: state.settings.bases[p],
      accounts: listAccounts(p).map(publicAccount),
      defaultAccountId: getDefaultAccount(p)?.id ?? '',
      preferredAccountId: getAccount(p)?.id ?? '',
    })),
  });
};

/** POST /settings —— 写上游地址 / 默认音质 / 公开接口访问控制 */
const adminSetSettings: Handler = async (req, res) => {
  const body = (req.body ?? {}) as Record<string, any>;
  const bases = body?.bases ?? {};
  for (const p of PLATFORMS) {
    if (typeof bases[p] === 'string' && bases[p].trim()) {
      state.settings.bases[p] = bases[p].trim().replace(/\/$/, '');
    }
  }
  if (typeof body?.quality === 'string' && body.quality.trim()) {
    state.settings.quality = body.quality.trim();
  }
  // 监听地址：仅接受 127.0.0.1（仅本机）与 0.0.0.0（所有网卡），其他值忽略
  if (typeof body?.listenAddress === 'string') {
    const v = body.listenAddress.trim();
    if (v === '127.0.0.1' || v === '0.0.0.0') state.settings.listenAddress = v;
  }
  // IP 白名单：仅 0.0.0.0 模式下接受；逐条归一化去重，非法 IP 丢弃
  if (body?.ipWhitelist !== undefined) {
    const raw = Array.isArray(body.ipWhitelist) ? body.ipWhitelist : [];
    const cleaned = Array.from(new Set(
      raw.map((x: unknown) => (typeof x === 'string' ? normalizeIp(x) : ''))
        .filter((x: string) => !!x && isValidIp(x)),
    ));
    state.settings.ipWhitelist = state.settings.listenAddress === '0.0.0.0' ? cleaned : [];
  }
  saveSettings(state.ctx);
  ok(res, state.settings);
};

/** POST /accounts/manual —— 手动添加账号 */
const adminAddAccount: Handler = async (req, res) => {
  const platform = reqPlatform(req);
  if (!platform) return fail(res, -1, `platform 必须是 ${PLATFORMS.join(' / ')}`);
  const cred: Credential = {};
  for (const k of ['token', 'cookie', 'userId', 'channel']) {
    const v = b(req, k).trim();
    if (v) (cred as any)[k] = v;
  }
  if (!cred.token && !cred.cookie && !cred.userId) {
    return fail(res, -1, '请至少填写 token / cookie / userId 之一');
  }
  const acc = addAccount(platform, cred, b(req, 'name'));
  const fresh = await autoProbe(platform, acc.id);
  ok(res, fresh || publicAccount(acc));
};

/** POST /accounts/qr/start —— 发起扫码，key 暂存内存 */
const adminQrStart: Handler = async (req, res) => {
  const platform = reqPlatform(req);
  if (!platform) return fail(res, -1, `platform 必须是 ${PLATFORMS.join(' / ')}`);
  const channel = b(req, 'channel') || 'qq';
  const name = b(req, 'name');
  try {
    const base = state.settings.bases[platform];
    const key = await PROVIDERS[platform].qrKey(base, channel);
    const img = await PROVIDERS[platform].qrCreate(base, key);
    pendingQr.set(key, { platform, channel, name, at: Date.now() });
    ok(res, {
      platform, key, qrimg: img,
      message: img ? '' : '二维码图片为空，请确认上游扫码接口是否返回 qrimg',
    });
  } catch (e) {
    fail(res, -2, e instanceof Error ? e.message : String(e));
  }
};

/** POST /accounts/qr/check —— 轮询扫码；成功后新增账号 */
const adminQrCheck: Handler = async (req, res) => {
  const platform = reqPlatform(req);
  if (!platform) return fail(res, -1, '缺少 platform');
  const key = b(req, 'key');
  if (!key) return fail(res, -1, '缺少扫码 key，请先发起扫码');
  const pending = pendingQr.get(key);
  const channel = b(req, 'channel') || pending?.channel || 'qq';
  try {
    const r = await PROVIDERS[platform].qrCheck(state.settings.bases[platform], key, channel);
    if (r.status === 'ok' && r.credential) {
      const acc = addAccount(
        platform,
        { ...r.credential, channel: pending?.channel || channel },
        pending?.name || b(req, 'name'),
      );
      pendingQr.delete(key);
      // 登录成功后自动探测一次昵称/头像，前端可直接显示「备注名 - 账号名」
      const fresh = await autoProbe(platform, acc.id);
      ok(res, { status: 'ok', message: '登录成功，账号已加入', account: fresh || publicAccount(acc) });
    } else {
      ok(res, { status: r.status });
    }
  } catch (e) {
    fail(res, -2, e instanceof Error ? e.message : String(e));
  }
};

/** POST /accounts/update —— 重命名 / 启停 */
const adminUpdateAccount: Handler = async (req, res) => {
  const platform = reqPlatform(req);
  const id = b(req, 'id');
  if (!platform || !id) return fail(res, -1, '缺少 platform 或 id');
  const patch: { name?: string; enabled?: boolean } = {};
  if (b(req, 'name')) patch.name = b(req, 'name');
  if (b(req, 'enabled') === 'true') patch.enabled = true;
  if (b(req, 'enabled') === 'false') patch.enabled = false;
  const acc = patchAccount(platform, id, patch);
  if (!acc) return fail(res, -1, '账号不存在');
  ok(res, publicAccount(acc));
};

/** POST /accounts/default —— 设为默认账号 */
const adminDefaultAccount: Handler = async (req, res) => {
  const platform = reqPlatform(req);
  const id = b(req, 'id');
  if (!platform || !id) return fail(res, -1, '缺少 platform 或 id');
  if (!setDefaultAccount(platform, id)) return fail(res, -1, '账号不存在');
  ok(res, { message: '已设为默认账号' });
};

/** POST /accounts/remove —— 删除账号 */
const adminRemoveAccount: Handler = async (req, res) => {
  const platform = reqPlatform(req);
  const id = b(req, 'id');
  if (!platform || !id) return fail(res, -1, '缺少 platform 或 id');
  if (!removeAccount(platform, id)) return fail(res, -1, '账号不存在');
  ok(res, { message: '账号已删除' });
};

/** POST /accounts/refresh —— 手动刷新单个账号凭证 */
const adminRefreshAccount: Handler = async (req, res) => {
  const platform = reqPlatform(req);
  const id = b(req, 'id');
  if (!platform || !id) return fail(res, -1, '缺少 platform 或 id');
  const acc = getAccount(platform, id);
  if (!acc) return fail(res, -1, '账号不存在');
  const cred = getCredential(platform, id);
  if (!cred) return fail(res, -1, '该账号没有凭证');
  try {
    const next = await PROVIDERS[platform].refresh(state.settings.bases[platform], cred);
    updateAccountCredential(platform, id, next);
    const fresh = await autoProbe(platform, id);
    ok(res, fresh || publicAccount(updateAccountCredential(platform, id, next)!));
  } catch (e) {
    fail(res, -2, e instanceof Error ? e.message : String(e));
  }
};

/** GET /accounts/status?platform=qq&id=xxx —— 探测能否拿到登录资料 */
const adminAccountStatus: Handler = async (req, res) => {
  const platform = getPlatform(req);
  const id = q(req, 'id');
  if (!platform || !id) return fail(res, -1, '缺少 platform 或 id');
  const acc = getAccount(platform, id);
  if (!acc) return fail(res, -1, '账号不存在');
  try {
    const probe = await probeStatus(platform, state.settings.bases[platform], getCredential(platform, id));
    if (probe.found && probe.profile) setAccountProfile(platform, id, probe.profile);
    ok(res, { found: probe.found, detail: probe.detail, profile: probe.profile ?? acc.profile });
  } catch (e) {
    fail(res, -2, e instanceof Error ? e.message : String(e));
  }
};

// ───────────────────────── 生命周期 ─────────────────────────

let refreshTimer: ReturnType<typeof setInterval> | null = null;
let sessionCleanTimer: ReturnType<typeof setInterval> | null = null;

async function refreshAllCredentials(ctx: Ctx): Promise<void> {
  for (const p of PLATFORMS) {
    for (const a of listAccounts(p)) {
      if (!a.enabled || (!a.token && !a.cookie)) continue;
      const cred = getCredential(p, a.id);
      if (!cred) continue;
      try {
        const next = await PROVIDERS[p].refresh(state.settings.bases[p], cred);
        updateAccountCredential(p, a.id, next);
        dlog(ctx, `[音乐服务前置] 已刷新 ${PLATFORM_NAMES[p]} / ${a.name}`);
      } catch (e) {
        ctx.logger.warn(`[音乐服务前置] 刷新 ${PLATFORM_NAMES[p]} / ${a.name} 失败：${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
}

export async function plugin_init(ctx: Ctx): Promise<void> {
  loadState(ctx);
  resetGlobalGuard();

  // 拉起内置上游服务（异步，不阻塞插件加载；各自等待端口就绪）
  void startAllServices(ctx);

  // 公开数据路由
  ctx.router.getNoAuth('/health', publicHealth);
  ctx.router.getNoAuth('/platforms', publicPlatforms);
  ctx.router.getNoAuth('/search', publicSearch);
  ctx.router.getNoAuth('/pick', publicPick);

  // WebUI 管理路由
  ctx.router.get('/settings', adminGetSettings);
  ctx.router.post('/settings', adminSetSettings);
  ctx.router.post('/accounts/manual', adminAddAccount);
  ctx.router.post('/accounts/qr/start', adminQrStart);
  ctx.router.post('/accounts/qr/check', adminQrCheck);
  ctx.router.post('/accounts/update', adminUpdateAccount);
  ctx.router.post('/accounts/default', adminDefaultAccount);
  ctx.router.post('/accounts/remove', adminRemoveAccount);
  ctx.router.post('/accounts/refresh', adminRefreshAccount);
  ctx.router.get('/accounts/status', adminAccountStatus);

  ctx.router.page({
    path: 'admin',
    title: '音乐服务前置',
    description: '三平台音源网关 · 多账号管理 · 搜索测试与对外接口',
    htmlFile: 'webui/admin.html',
  });

  refreshTimer = setInterval(() => { void refreshAllCredentials(ctx); }, 30 * 60 * 1000);
  sessionCleanTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, s] of state.sessions) {
      if (s.createdAt && now - s.createdAt > 2 * 60 * 60 * 1000) state.sessions.delete(id);
    }
    const qrTtl = now - 10 * 60 * 1000;
    for (const [key, item] of pendingQr) if (item.at < qrTtl) pendingQr.delete(key);
  }, 10 * 60 * 1000);

  klog(ctx, '[音乐服务前置] 已加载。公开路由：/plugin/kz-plugin-music-front/api/{health,platforms,search,pick}');
}

export async function plugin_cleanup(ctx: Ctx): Promise<void> {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  if (sessionCleanTimer) { clearInterval(sessionCleanTimer); sessionCleanTimer = null; }
  state.sessions.clear();
  pendingQr.clear();
  await stopAllServices(ctx);
  klog(ctx, '[音乐服务前置] 已卸载，定时器、会话缓存与内置服务已清理');
}

/** 导出给同类型扩展插件调用（getPluginExports，仅限扩展之间） */
export const api = {
  async search(platform: Platform, keyword: string, page = 1, limit = 20, accountId?: string) {
    const candidates = accountCandidates(platform, accountId);
    let lastErr: unknown;
    for (const acc of candidates) {
      try {
        const r = await PROVIDERS[platform].search(
          state.settings.bases[platform], keyword, page, limit, credOf(acc),
        );
        return cacheSearch({
          platform, keyword, page, total: r.total, list: r.songs,
          accountId: acc.id, accountName: acc.name,
        });
      } catch (e) {
        lastErr = e;
        if (accountId) break;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr || '搜索失败'));
  },
  async pick(platform: Platform, id: string, quality?: string, accountId?: string) {
    const candidates = accountCandidates(platform, accountId);
    let lastErr: unknown;
    for (const acc of candidates) {
      try {
        return await PROVIDERS[platform].getUrl(
          state.settings.bases[platform],
          { seq: 0, id, title: '', artist: '', album: '', cover: '', duration: 0 },
          quality || state.settings.quality,
          credOf(acc),
        );
      } catch (e) {
        lastErr = e;
        if (accountId) break;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr || '取直链失败'));
  },
  getSession,
  listAccounts,
  resetGlobalGuard,
  globalGuardState,
};
