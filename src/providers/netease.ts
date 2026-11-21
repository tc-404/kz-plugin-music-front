/** 网易云 provider —— 对接 NeteaseCloudMusicApiEnhanced/api-enhanced (默认 3000) */

import type { Credential, StdSong } from '../types';
import { buildUrl, credToHeaders, credToQuery, fetchJson, findPlayableUrl, firstText, isUpstreamError, pick, toSeconds, upstreamErrorMsg } from '../util';
import type { SearchOut, UrlOut } from './qq';

/** 搜索：GET /search?keywords=&type=1&limit=&offset= → result.songs[] */
export async function search(
  base: string, keyword: string, page: number, limit: number, cred: Credential | undefined,
): Promise<SearchOut> {
  const offset = Math.max(0, (page - 1) * limit);
  const url = buildUrl(base, '/search', {
    keywords: keyword,
    type: 1,
    limit,
    offset,
    ...credToQuery('netease', cred),
  });
  const data = await fetchJson(url, { headers: credToHeaders('netease', cred), timeoutMs: 15000 });
  if (isUpstreamError(data)) throw new Error(upstreamErrorMsg(data));

  const songsRaw = pick(data, ['result.songs', 'songs', 'data.songs'], []);
  const list = Array.isArray(songsRaw) ? songsRaw : [];
  const songs: StdSong[] = list.map((it: any, idx: number) => {
    const id = String(pick(it, ['id', 'songId'], ''));
    const title = String(pick(it, ['name', 'title'], '未知歌曲'));
    const artist = firstText(pick(it, ['artists', 'artist', 'singer'], []), ['name'])
      || String(pick(it, ['artistName'], ''));
    const albumObj = pick(it, ['album', 'albumInfo'], {});
    const album = typeof albumObj === 'string' ? albumObj : String(pick(albumObj, ['name', 'title'], ''));
    const cover = String(pick(it, ['cover', 'picUrl', 'image'], pick(albumObj, ['picUrl', 'cover', 'image'], '')));
    const duration = toSeconds(pick(it, ['duration', 'dt', 'length'], 0));
    return { seq: idx + 1, id, title, artist, album, cover, duration };
  }).filter((s: StdSong) => !!s.id);

  // 搜索接口只给 album.picId（数字），没有现成封面 URL；用 /song/detail 批量补齐。
  // 该接口支持 ids=id1,id2,... 一次取回全部，失败则静默保留空封面，不影响搜索。
  if (songs.length && songs.some((s) => !s.cover)) {
    try {
      const detail = await fetchJson(buildUrl(base, '/song/detail', {
        ids: songs.map((s) => s.id).join(','),
        ...credToQuery('netease', cred),
      }), { headers: credToHeaders('netease', cred), timeoutMs: 12000 });
      if (!isUpstreamError(detail)) {
        const details = pick(detail, ['songs', 'data.songs'], []);
        const coverById = new Map<string, string>();
        if (Array.isArray(details)) {
          for (const d of details) {
            const picUrl = String(pick(d, [
              'al.picUrl', 'album.picUrl', 'picUrl', 'album.pic', 'al.pic',
            ], ''));
            if (picUrl) coverById.set(String(pick(d, ['id', 'songId'], '')), picUrl);
          }
        }
        for (const s of songs) if (!s.cover && coverById.has(s.id)) s.cover = coverById.get(s.id)!;
      }
    } catch { /* 补齐失败不影响搜索结果 */ }
  }

  const totalRaw = pick(data, ['result.songCount', 'songCount', 'total', 'result.total'], songs.length);
  return { total: Number(totalRaw) || songs.length, songs };
}

/** 取直链：GET /song/url?id= → data[0].url */
export async function getUrl(
  base: string, song: StdSong, quality: string, cred: Credential | undefined,
): Promise<UrlOut> {
  const url = buildUrl(base, '/song/url', {
    id: song.id,
    br: quality && /^\d+$/.test(quality) ? Number(quality) * 1000 : undefined,
    ...credToQuery('netease', cred),
  });
  const data = await fetchJson(url, { headers: credToHeaders('netease', cred), timeoutMs: 15000 });
  if (isUpstreamError(data)) throw new Error(upstreamErrorMsg(data));

  const direct = findPlayableUrl(data, song.id);
  if (!direct) throw new Error('该歌曲暂无可用播放直链（可能需登录会员或歌曲已下架）');
  const arr = pick(data, ['data', 'songs'], data);
  const entry = Array.isArray(arr) ? arr[0] : pick(arr, [song.id], undefined);
  const br = Number(pick(entry, ['br', 'bitrate'], 0));
  const realQuality = br ? `${Math.round(br / 1000)}k` : (quality || '');
  return { url: direct, quality: realQuality };
}

/** 扫码登录：/login/qr/key → /login/qr/create?key=&qrimg=true → /login/qr/check?key= */
export async function qrKey(base: string): Promise<string> {
  const data = await fetchJson(buildUrl(base, '/login/qr/key', {}), { timeoutMs: 12000 });
  if (isUpstreamError(data)) throw new Error(upstreamErrorMsg(data));
  const key = String(pick(data, ['unikey', 'key', 'qrKey'], pick(data?.data, ['unikey', 'key'], '')));
  if (!key) throw new Error('获取二维码标识失败');
  return key;
}

export async function qrCreate(base: string, key: string): Promise<string> {
  const data = await fetchJson(buildUrl(base, '/login/qr/create', { key, qrimg: 'true' }), { timeoutMs: 12000 });
  if (isUpstreamError(data)) throw new Error(upstreamErrorMsg(data));
  return String(pick(data, ['qrimg', 'qrcode'], pick(data?.data, ['qrimg', 'qrcode'], '')));
}

export async function qrCheck(base: string, key: string): Promise<{ status: string; credential?: Credential }> {
  // 网易云官方要求轮询务必带时间戳防止缓存；否则手机确认后拿到的还是旧的 801「等待扫码」，
  // 表现为「手机上已确认登录，WebUI 仍停在二维码/等待状态」。
  const data = await fetchJson(buildUrl(base, '/login/qr/check', { key, timestamp: String(Date.now()) }), { timeoutMs: 12000 });
  if (isUpstreamError(data)) throw new Error(upstreamErrorMsg(data));
  const code = Number(pick(data, ['code', 'status'], 0));
  const cookie = String(pick(data, ['cookie'], pick(data?.data, ['cookie'], '')));

  // 兜底：只要拿到有效登录 cookie（含 MUSIC_U），无论状态码定义如何都视为成功。
  // 不同 api-enhanced 版本成功码可能是 803，cookie 也可能直接给出，以 cookie 为准更稳。
  if (code === 803 || /MUSIC_U=/.test(cookie)) {
    return { status: 'ok', credential: { cookie, updatedAt: Date.now() } };
  }
  if (code === 802) return { status: 'scanned' };
  if (code === 801) return { status: 'waiting' };
  return { status: 'expired' };
}

/** 网易云增强版无内置定时刷新；有 cookie 时尝试 /login/refresh，失败则原样返回 */
export async function refresh(base: string, cred: Credential): Promise<Credential> {
  try {
    const data = await fetchJson(buildUrl(base, '/login/refresh', { ...credToQuery('netease', cred) }), {
      method: 'GET',
      headers: credToHeaders('netease', cred),
      timeoutMs: 12000,
    });
    if (!isUpstreamError(data)) {
      const cookie = String(pick(data, ['cookie'], pick(data?.data, ['cookie'], cred.cookie ?? '')));
      return { ...cred, cookie: cookie || cred.cookie, updatedAt: Date.now() };
    }
  } catch { /* 忽略，沿用原凭证 */ }
  return { ...cred, updatedAt: Date.now() };
}
