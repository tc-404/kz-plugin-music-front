/** 音乐服务前置 — 类型定义 */

export type Platform = 'qq' | 'netease' | 'kugou';

export const PLATFORMS: Platform[] = ['qq', 'netease', 'kugou'];

export const PLATFORM_NAMES: Record<Platform, string> = {
  qq: 'QQ音乐',
  netease: '网易云音乐',
  kugou: '酷狗音乐',
};

/** 每个平台的默认上游地址 */
export const DEFAULT_BASES: Record<Platform, string> = {
  qq: 'http://127.0.0.1:9500/qq',      // 统一进程 → QQ worker
  netease: 'http://127.0.0.1:9500/netease', // 统一进程 → 网易云 worker
  kugou: 'http://127.0.0.1:9500/kugou',   // 统一进程 → 酷狗 worker
};

/** 传给 provider 的登录凭证（不含账号元信息） */
export interface Credential {
  token?: string;
  cookie?: string;
  userId?: string;
  qrKey?: string;
  /** 扫码登录通道（QQ 用：qq / wechat / qqmusic） */
  channel?: string;
  updatedAt?: number;
}

/** 上游探测到的账号资料（昵称等，用于后台展示，不落敏感信息） */
export interface AccountProfile {
  nickname?: string;
  avatar?: string;
  vip?: boolean;
  userId?: string;
  checkedAt?: number;
}

/** 一个平台下的一个登录账号 */
export interface Account extends Credential {
  id: string;
  /** 用户自定义备注名 */
  name: string;
  enabled: boolean;
  isDefault: boolean;
  createdAt: number;
  profile?: AccountProfile;
}

/** 平台 -> 账号列表 */
export type AccountMap = Partial<Record<Platform, Account[]>>;

/** WebUI 可见的账号信息：凭证一律脱敏，绝不回传明文 */
export interface PublicAccount {
  id: string;
  name: string;
  enabled: boolean;
  isDefault: boolean;
  hasToken: boolean;
  hasCookie: boolean;
  tokenMask: string;
  cookieMask: string;
  userId: string;
  updatedAt: number;
  profile?: AccountProfile;
}

/** 标准化歌曲（三平台统一） */
export interface StdSong {
  /** 列表序号，1 开始 */
  seq: number;
  /** 平台内歌曲 id（QQ=songmid，网易云=id，酷狗=hash） */
  id: string;
  title: string;
  artist: string;
  album: string;
  /** 时长（秒） */
  duration: number;
  cover: string;
}

/** 搜索结果（对外公开路由返回） */
export interface SearchResult {
  platform: Platform;
  keyword: string;
  page: number;
  total: number;
  sessionId: string;
  list: StdSong[];
  /** 本次搜索使用的账号，pick 时沿用同一个账号 */
  accountId?: string;
  accountName?: string;
  /** 会话创建时间（用于过期清理） */
  createdAt?: number;
}

/** 按序号选歌后的精准内容 */
export interface PickResult {
  platform: Platform;
  seq: number;
  id: string;
  title: string;
  artist: string;
  album: string;
  cover: string;
  duration: number;
  url: string;
  quality: string;
  accountId?: string;
  accountName?: string;
}

/** 配置：三个上游服务地址 + 默认音质 + 公开接口访问控制 */
export interface Settings {
  bases: Record<Platform, string>;
  quality: string;
  /** 公开接口监听地址：127.0.0.1=仅本机，0.0.0.0=所有网卡；默认仅本机 */
  listenAddress: string;
  /** IP 白名单：仅 listenAddress 为 0.0.0.0 时生效；空数组=不限制 */
  ipWhitelist: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  bases: { ...DEFAULT_BASES },
  quality: '320',
  listenAddress: '127.0.0.1',
  ipWhitelist: [],
};

/** 上下文最小类型（真实宿主类型见宿主 plugin.types.ts） */
export interface Ctx {
  pluginName: string;
  pluginPath: string;
  dataPath: string;
  configPath: string;
  logger: {
    log(...a: unknown[]): void;
    info(...a: unknown[]): void;
    warn(...a: unknown[]): void;
    error(...a: unknown[]): void;
    debug(...a: unknown[]): void;
  };
  router: {
    get(path: string, h: Handler): void;
    post(path: string, h: Handler): void;
    put(path: string, h: Handler): void;
    delete(path: string, h: Handler): void;
    getNoAuth(path: string, h: Handler): void;
    postNoAuth(path: string, h: Handler): void;
    page(def: { path: string; title: string; description?: string; htmlFile: string; icon?: string }): void;
  };
}

export interface Req {
  query: Record<string, unknown>;
  body: unknown;
  params: Record<string, string>;
  headers: Record<string, string | string[] | undefined>;
  path: string;
}

export interface Res {
  status(code: number): Res;
  json(data: unknown): void;
  send(data: string | Buffer): void;
  type(t: string): Res;
  setHeader(name: string, value: string): Res;
}

export type Handler = (req: Req, res: Res) => void | Promise<void>;
