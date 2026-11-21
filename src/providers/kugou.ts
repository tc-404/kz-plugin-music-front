/** 酷狗 provider —— 对接 MakcRe/KuGouMusicApi (默认 3000)
 *  路由由 module 文件名映射：search.js→/search、audio.js→/audio、login_qr_*.js→/login/qr/*
 *  凭证走 Authorization 头 `token=xxx;userid=xxx`，或 query cookie 参数
 */

import type { Credential, StdSong } from '../types';
import { buildUrl, cookieValue, credToHeaders, credToQuery, fetchJson, findPlayableUrl, isUpstreamError, pick, toSeconds, upstreamErrorMsg } from '../util';
import type { SearchOut, UrlOut } from './qq';

/** 搜索：GET /search?keywords=&type=song&page=&pagesize=
 *  酷狗官方相关度排序；sorttype=1 切最新（这里默认相关度） */
export async function search(
  base: string, keyword: string, page: number, limit: number, cred: Credential | undefined,
): Promise<SearchOut> {
  const url = buildUrl(base, '/search', {
    keywords: keyword,
    type: 'song',
    page,
    pagesize: limit,
    sorttype: 0,
    ...credToQuery('kugou', cred),
  });
  const data = await fetchJson(url, { headers: credToHeaders('kugou', cred), timeoutMs: 15000 });
  if (isUpstreamError(data)) throw new Error(upstreamErrorMsg(data));

  // 酷狗返回结构较深：data.data.lists / data.lists / data.records
  const rawList = pick(data, [
    'data.lists', 'data.data.lists', 'data.records', 'lists', 'data.songs', 'data.data',
  ], []);
  let list: any[] = Array.isArray(rawList) ? rawList : [];
  if (!list.length && Array.isArray(data?.data?.data?.lists)) list = data.data.data.lists;
  if (!list.length && Array.isArray(data?.lists)) list = data.lists;

  const songs: StdSong[] = list.map((it: any, idx: number) => {
    // MakcRe/KuGouMusicApi 的 search.js 直接透传酷狗官方字段，均为大写开头：
    // SongName / SingerName / AlbumName / FileHash / Duration / Image。
    // 旧的小写候选保留，兼容其他酷狗上游实现。
    const id = String(pick(it, [
      'FileHash', 'fileHash', 'hash', 'HQFileHash', 'SQFileHash',
      'audio_id', 'Audioid', 'audioId', 'ID', 'id', 'songid', 'song_id',
    ], ''));
    const title = String(pick(it, [
      'SongName', 'songname', 'songName', 'name', 'title', 'OriSongName',
    ], '未知歌曲'));
    const artist = String(pick(it, [
      'SingerName', 'singername', 'singerName', 'author', 'artist',
    ], ''));
    const album = String(pick(it, [
      'AlbumName', 'album_name', 'albumName', 'album',
    ], ''));
    // 酷狗封面地址里的 {size} 是模板占位符，必须替换，否则前端图片加载失败
    const cover = String(pick(it, [
      'Image', 'imgUrl', 'cover', 'pic', 'image', 'album_img', 'AlbumImage',
    ], '')).replace('{size}', '240');
    const duration = toSeconds(pick(it, [
      'Duration', 'HQDuration', 'duration', 'duration_ms', 'song_duration', 'length',
    ], 0));
    return { seq: idx + 1, id, title, artist, album, cover, duration };
  }).filter((s: StdSong) => !!s.id);

  const totalRaw = pick(data, ['data.total', 'total', 'data.data.total'], list.length || songs.length);
  return { total: Number(totalRaw) || songs.length, songs };
}

/** 取直链：两步
 *  1) GET /audio?hash=<FileHash> —— 只返回各音质对应的 hash 元数据（部分旧版上游会直接给 url）
 *  2) GET /song/url?hash=<对应音质hash>&quality=<bitrate> —— 用 hash 换真实播放地址
 *  酷狗对 trackercdn 有风控（errcode=20028「本次请求需要验证」），此时把上游原文回传，
 *  避免前端只看到笼统的「暂无可用播放直链」。
 */
export async function getUrl(
  base: string, song: StdSong, quality: string, cred: Credential | undefined,
): Promise<UrlOut> {
  const q = ['128', '320', 'flac', 'high'].includes(quality) ? quality : '128';
  const opts = { headers: credToHeaders('kugou', cred), timeoutMs: 15000 };
  const audioData = await fetchJson(buildUrl(base, '/audio', {
    hash: song.id, ...credToQuery('kugou', cred),
  }), opts);
  if (isUpstreamError(audioData)) throw new Error(upstreamErrorMsg(audioData));

  // 兼容直接在 /audio 返回 url 的酷狗上游
  const direct = findPlayableUrl(audioData, song.id);
  if (direct) return { url: direct, quality: quality || '' };

  const meta = (Array.isArray(audioData?.data) ? audioData.data[0] : audioData?.data) ?? {};
  const hashByQuality: Record<string, string> = {
    '320': String(pick(meta, ['hash_320'], '')),
    flac: String(pick(meta, ['hash_flac'], '')),
    high: String(pick(meta, ['hash_high'], '')),
  };
  const hash = hashByQuality[q] || song.id;
  const urlData = await fetchJson(buildUrl(base, '/song/url', {
    hash, quality: q, ...credToQuery('kugou', cred),
  }), opts);
  if (isUpstreamError(urlData)) throw new Error(upstreamErrorMsg(urlData));

  // 上游风控原文（status=2 / errcode=20028 / error="本次请求需要验证"）
  const upstreamErr = String(pick(urlData, ['error', 'errmsg', 'err_msg'], ''));
  if (upstreamErr && !/^https?:\/\//i.test(upstreamErr)) {
    const code = pick(urlData, ['errcode', 'error_code', 'status'], '');
    throw new Error(`酷狗上游拒绝取直链：${upstreamErr}${code !== '' ? `（errcode=${code}）` : ''}`);
  }

  const rawUrl = findPlayableUrl(urlData, hash) || pick(urlData, ['data.0.url', 'url'], '');
  // 上游 url 可能是数组；绝不能直接 String(array)，否则会变成 "url1,url2" 的无效地址（访问 403）
  const url = Array.isArray(rawUrl)
    ? String(rawUrl.find((x: any) => /^https?:\/\//i.test(String(x))) || '')
    : String(rawUrl);
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error('该歌曲暂无可用播放直链（酷狗部分歌曲需登录/VIP）');
  }
  return { url, quality: q };
}

/** 扫码登录：/login/qr/key → /login/qr/create?key=&qrimg=true → /login/qr/check?key=
 *  实测（MakcRe/KuGouMusicApi）：
 *   - key 接口返回 data.qrcode（key）与 data.qrcode_img（图片）
 *   - create 接口带 qrimg=true 返回 data.base64（data:image/png;base64...）
 *   - check 接口 data.status：0=过期、1=等待扫码、2=待确认、4=授权成功（带 token/userid）
 */
export async function qrKey(base: string): Promise<string> {
  const data = await fetchJson(buildUrl(base, '/login/qr/key', { timestamp: String(Date.now()) }), { timeoutMs: 12000 });
  if (isUpstreamError(data)) throw new Error(upstreamErrorMsg(data));
  // 真实字段是 data.qrcode（旧写法 qrkey/unikey 作为兼容兜底）
  const key = String(pick(data, ['data.qrcode', 'qrcode', 'qrkey', 'key', 'unikey', 'qrKey'], pick(data?.data, ['qrcode', 'qrkey', 'key', 'unikey'], '')));
  if (!key) throw new Error('获取二维码标识失败：酷狗上游未返回 data.qrcode，请确认内置服务已启动');
  return key;
}

export async function qrCreate(base: string, key: string): Promise<string> {
  const data = await fetchJson(buildUrl(base, '/login/qr/create', { key, qrimg: 'true', timestamp: String(Date.now()) }), { timeoutMs: 12000 });
  if (isUpstreamError(data)) throw new Error(upstreamErrorMsg(data));
  // 真实字段是 data.base64；也兼容 key 接口直接返回的 qrcode_img
  return String(pick(data, ['data.base64', 'base64', 'qrimg', 'qrcode_img'], pick(data?.data, ['base64', 'qrimg', 'qrcode_img'], '')));
}

/** 酷狗扫码成功返回 token + userid
 *
 *  关键：酷狗上游 server.js 对所有 200 响应做了 2 分钟 apicache 缓存，
 *  固定 URL 的轮询会一直拿到「等待扫码」的旧结果，手机确认后也不更新——
 *  表现为「已确认但 WebUI 仍显示二维码」。上游官方绕过方式就是加 timestamp。
 */
export async function qrCheck(base: string, key: string): Promise<{ status: string; credential?: Credential }> {
  const data = await fetchJson(buildUrl(base, '/login/qr/check', { key, timestamp: String(Date.now()) }), { timeoutMs: 12000 });
  if (isUpstreamError(data)) throw new Error(upstreamErrorMsg(data));
  const inner = pick(data, ['data'], data) ?? {};
  // status 优先取 data.status；实测顶层 status 可能是另一值（如 data.status=0 / 顶层 status=1）
  const status = Number(pick(inner, ['status'], pick(data, ['status'], -1)));
  // 上游成功时把 token/userid 同时写进响应体 data 和 Set-Cookie 头，两边都取，互为兜底
  const setCookie = String((data as any)?.__setCookie ?? '');
  const token = String(pick(inner, ['token'], pick(data, ['token'], cookieValue(setCookie, 'token'))));
  const userId = String(pick(inner, ['userid', 'userId', 'user_id'], pick(data, ['userid', 'userId'], cookieValue(setCookie, 'userid'))));

  // 有 token 即为成功（最可靠，兼容 status 值不一致的情况）；或 status=4
  if (token || status === 4) {
    return { status: 'ok', credential: { token, userId, updatedAt: Date.now() } };
  }
  if (status === 2) return { status: 'scanned' }; // 待确认
  if (status === 0) return { status: 'expired' }; // 过期
  return { status: 'waiting' }; // status=1 或未知，继续轮询
}

/** 酷狗内置刷新登录：/login/token（login_token.js） */
export async function refresh(base: string, cred: Credential): Promise<Credential> {
  try {
    const data = await fetchJson(buildUrl(base, '/login/token', { ...credToQuery('kugou', cred) }), {
      headers: credToHeaders('kugou', cred), timeoutMs: 12000,
    });
    if (!isUpstreamError(data)) {
      const inner = pick(data, ['data'], data) ?? {};
      const token = String(pick(inner, ['token'], pick(data, ['token'], cred.token ?? '')));
      const userId = String(pick(inner, ['userid', 'userId'], pick(data, ['userid', 'userId'], cred.userId ?? '')));
      return { ...cred, token: token || cred.token, userId: userId || cred.userId, updatedAt: Date.now() };
    }
  } catch { /* 沿用原凭证 */ }
  return { ...cred, updatedAt: Date.now() };
}
