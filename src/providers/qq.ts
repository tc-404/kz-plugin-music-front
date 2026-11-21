/** QQ音乐 provider —— 对接 yakult-green-tea/qq-music-api (默认 9500) */

import type { Credential, StdSong } from '../types';
import { buildUrl, cookieValue, credToHeaders, credToQuery, fetchJson, findPlayableUrl, firstText, isUpstreamError, pick, toSeconds, upstreamErrorMsg } from '../util';

export interface SearchOut { total: number; songs: StdSong[]; }
export interface UrlOut { url: string; quality: string; }

/** QQ 搜索：GET /search?keyword=&type=song&page=&limit= → { total, more, items[] } */
export async function search(
  base: string, keyword: string, page: number, limit: number, cred: Credential | undefined,
): Promise<SearchOut> {
  const url = buildUrl(base, '/search', {
    keyword,
    type: 'song',
    page,
    limit,
    ...credToQuery('qq', cred),
  });
  const data = await fetchJson(url, { headers: credToHeaders('qq', cred), timeoutMs: 15000 });
  if (isUpstreamError(data)) throw new Error(upstreamErrorMsg(data));

  const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data?.data?.items) ? data.data.items : []);
  const songs: StdSong[] = items.map((it: any, idx: number) => {
    // yakult 项目 items 字段较灵活，宽松解析常见命名
    const id = String(pick(it, ['mid', 'songmid', 'songMid', 'id', 'songId'], ''));
    const title = String(pick(it, ['title', 'name', 'songname', 'songName'], '未知歌曲'));
    const artist = firstText(pick(it, ['singer', 'artists', 'artist'], []), ['name', 'title'])
      || String(pick(it, ['artistName', 'author'], ''));
    const albumObj = pick(it, ['album', 'albumInfo'], {});
    const album = typeof albumObj === 'string'
      ? albumObj
      : String(pick(albumObj, ['title', 'name', 'albumName'], ''));
    const coverRaw = String(pick(it, ['cover', 'image', 'pic', 'albumPic'], pick(albumObj, ['cover', 'pic', 'image'], '')));
    // yakult 搜索只给 album.mid，没有现成封面 URL；用官方图床拼 300x300 封面。
    const albumMid = typeof albumObj === 'string' ? '' : String(pick(albumObj, ['mid', 'pmid'], ''));
    const cover = coverRaw || (albumMid
      ? `https://y.qq.com/music/photo_new/T002R300x300M000${albumMid}.jpg`
      : '');
    const duration = toSeconds(pick(it, ['duration', 'interval'], 0));
    return { seq: idx + 1, id, title, artist, album, cover, duration };
  }).filter((s: StdSong) => !!s.id);

  const total = Number(pick(data, ['total', 'count'], songs.length)) || songs.length;
  return { total, songs };
}

/** QQ 取直链：GET /getMusicPlay/:songmid?quality=xxx → data.playUrl[<mid>].url
 *
 *  实测：上游 vkey 接口对 320/ape 等高品质经常返回空 purl（result 104003），
 *  尤其是免费/非会员登录态。为避免「大部分歌曲取直链失败」，目标音质拿不到时
 *  自动降级依次重试更稳妥的档位（m4a → 128 → best），取到即返回，并把实际
 *  音质回传给前端展示。这样无论默认配置是 320 还是别的，都能尽量给出可播放链接。
 */
const QQ_QUALITY_FALLBACK = ['m4a', '128', 'best'];

export async function getUrl(
  base: string, song: StdSong, quality: string, cred: Credential | undefined,
): Promise<UrlOut> {
  const mid = encodeURIComponent(song.id);
  const wanted = quality || '320';
  // 去重后的尝试顺序：目标音质优先，随后降级档位
  const triedQualities = [wanted, ...QQ_QUALITY_FALLBACK.filter((q) => q !== wanted)];
  let firstUpstreamError = '';

  for (const q of triedQualities) {
    const url = buildUrl(base, `/getMusicPlay/${mid}`, {
      quality: q,
      ...credToQuery('qq', cred),
    });
    const data = await fetchJson(url, { headers: credToHeaders('qq', cred), timeoutMs: 15000 });
    if (isUpstreamError(data)) {
      if (!firstUpstreamError) firstUpstreamError = upstreamErrorMsg(data);
      continue;
    }

    // 真实结构为 data.playUrl[<songmid>] = { url, error, restriction }，
    // 递归提取真正直链（跳过 error/restriction 噪声字段）。
    const direct = findPlayableUrl(data, song.id);
    if (direct) {
      // 优先用上游回报的真实音质；没有则用本次实际成功的档位
      const reported = pick(data, ['quality', 'bitrate', 'type'], '');
      const realQuality = String(reported || (data?.data?.playUrl?.[song.id]?.source?.quality) || q);
      return { url: direct, quality: realQuality };
    }
  }

  if (firstUpstreamError) throw new Error(firstUpstreamError);
  throw new Error('该歌曲暂无可用播放直链（可能需登录、非会员或受版权限制，已尝试多个音质档位）');
}

/** 扫码登录（ yakult：/login/qr/key?channel=qq → /login/qr/create?key= → /login/qr/check?key= ） */
export async function qrKey(base: string, channel = 'qq'): Promise<string> {
  const url = buildUrl(base, '/login/qr/key', { channel });
  const data = await fetchJson(url, { timeoutMs: 12000 });
  if (isUpstreamError(data)) throw new Error(upstreamErrorMsg(data));
  const key = String(pick(data, ['unikey', 'key', 'qrKey'], pick(data?.data, ['unikey', 'key'], '')));
  if (!key) throw new Error('获取二维码标识失败');
  return key;
}

export async function qrCreate(base: string, key: string): Promise<string> {
  const url = buildUrl(base, '/login/qr/create', { key });
  const data = await fetchJson(url, { timeoutMs: 12000 });
  if (isUpstreamError(data)) throw new Error(upstreamErrorMsg(data));
  const img = String(pick(data, ['qrimg', 'qrcode', 'image'], pick(data?.data, ['qrimg', 'qrcode', 'image'], '')));
  return img;
}

/** 返回 { status: 'waiting'|'scanned'|'ok'|'expired', credential? } */
export async function qrCheck(base: string, key: string, channel = 'qq'): Promise<{ status: string; credential?: Credential }> {
  const url = buildUrl(base, '/login/qr/check', { key, channel });
  const data = await fetchJson(url, { timeoutMs: 12000 });
  if (isUpstreamError(data)) throw new Error(upstreamErrorMsg(data));
  const code = Number(pick(data, ['code', 'status'], 0));
  if (code === 803) {
    // 上游把会话 token 放在 cookie 字段 `qqmusic_session=xxx`，没有独立 token 字段
    const cookieStr = String(pick(data, ['cookie'], pick(data?.data, ['cookie'], '')));
    const token = cookieValue(cookieStr, 'qqmusic_session')
      || String(pick(data, ['token', 'sealedToken'], pick(data?.data, ['token', 'sealedToken'], '')));
    return { status: 'ok', credential: { token, cookie: cookieStr || undefined, channel, updatedAt: Date.now() } };
  }
  if (code === 802) return { status: 'scanned' };
  if (code === 801) return { status: 'waiting' };
  return { status: 'expired' };
}

/** 刷新：POST /login/refresh（sealed token 模式需要） */
export async function refresh(base: string, cred: Credential): Promise<Credential> {
  const url = buildUrl(base, '/login/refresh', {});
  const data = await fetchJson(url, {
    method: 'POST',
    headers: { ...credToHeaders('qq', cred), 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: cred.token ?? '' }),
    timeoutMs: 12000,
  });
  if (isUpstreamError(data)) throw new Error(upstreamErrorMsg(data));
  const cookieStr = String(pick(data, ['cookie'], pick(data?.data, ['cookie'], '')));
  const newToken = cookieValue(cookieStr, 'qqmusic_session')
    || String(pick(data, ['token', 'sealedToken'], pick(data?.data, ['token', 'sealedToken'], cred.token ?? '')));
  return { ...cred, token: newToken || cred.token, updatedAt: Date.now() };
}
