import { QqApiError } from '../../protocol/errors.js';
import { dictionaryOf, isDictionary, stringOf } from '../../util/values.js';
import { diagnose, failureResult, okResult } from './newRouteResult.js';
import { createSessionMusicuClient } from './sessionMusicu.js';
// src/services/recommend/recommendPlaylists.ts
//
// `/recommend/playlists`：歌单广场的推荐。有会话就带凭证，没有就匿名。Node 与 serverless 共用。
// 实测（2026-10）：参数是 `{ From, Size }`；条目在 `List[].Playlist.basic`。翻页不像有限列表
// （From 往后仍有条目、HasMore 却变 false），所以只开放 limit，不提供续读位置。
const DEFAULT_LIMIT = 25;
/** 实测一次要 60 张能拿到 60 张；更大的没有验证过。 */
const MAX_LIMIT = 60;
/** 和其他路由的分页参数一样宽松：不是正整数就用默认值，超过上限就压到上限。 */
export const recommendPlaylistsLimitOf = (raw) => {
    const value = Number.parseInt(String(raw ?? ''), 10);
    if (!Number.isSafeInteger(value) || value <= 0)
        return DEFAULT_LIMIT;
    return Math.min(MAX_LIMIT, value);
};
const decode = (data) => {
    if (!isDictionary(data))
        throw new QqApiError('invalid-response');
    const { List: list, HasMore: hasMore } = data;
    if (list !== null && list !== undefined && !Array.isArray(list))
        throw new QqApiError('invalid-response');
    return { list: Array.isArray(list) ? list : [], hasMore: hasMore === true };
};
const recommendFeed = (limit) => ({
    module: 'music.playlist.PlaylistSquare',
    method: 'GetRecommendFeed',
    param: { From: 0, Size: limit },
    readOnly: true,
    operation: 'recommend.playlists',
    decode,
});
const countOf = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const coverOf = (cover) => [cover.default_url, cover.big_url, cover.medium_url, cover.small_url]
    .map(stringOf)
    .find((url) => url !== '') ?? '';
const creatorOf = (creator) => Object.fromEntries(['uin', 'encrypt_uin', 'nick', 'avatar']
    .filter((key) => typeof creator[key] === 'string')
    .map((key) => [key, creator[key]]));
/**
 * 摊平成歌单列表常用的字段名（`tid`、`title`、`picurl`、`songnum`……），前端认歌单的那套读法就能用。
 * 没有可用 tid 的条目读不了歌，直接跳过；数字缺失就不给，不补 0。
 */
const toPlaylist = (entry) => {
    const basic = dictionaryOf(dictionaryOf(dictionaryOf(entry).Playlist).basic);
    const tid = basic.tid;
    if (typeof tid !== 'number' || !Number.isSafeInteger(tid) || tid <= 0)
        return null;
    const songnum = countOf(basic.song_cnt);
    const playCount = countOf(basic.play_cnt);
    return {
        tid,
        title: stringOf(basic.title),
        desc: stringOf(basic.desc),
        picurl: coverOf(dictionaryOf(basic.cover)),
        ...(songnum === undefined ? {} : { songnum }),
        ...(playCount === undefined ? {} : { play_cnt: playCount }),
        creator: creatorOf(dictionaryOf(basic.creator)),
    };
};
/**
 * 会话解不开时由宿主传 `null`，这里就匿名读；解得开但上游拒绝凭证时回 401，让前端清掉坏会话。
 * 上游给空列表回 422；给了条目但一张都读不出来回 502；部分能读照样 200，跳过的条数写进诊断。
 * `more` 原样反映上游的 HasMore，只是提示，不代表读完。
 */
export const recommendPlaylistsResult = async (session, limit, options = {}) => {
    try {
        const data = await createSessionMusicuClient(session, options).execute(recommendFeed(limit));
        // 上游真的给了空列表才是「没有数据」；给了条目却一张都读不出来，是格式变了。
        if (!data.list.length)
            throw new QqApiError('not-found');
        const playlists = data.list.map(toPlaylist).filter((item) => item !== null);
        if (!playlists.length)
            throw new QqApiError('invalid-response');
        if (playlists.length < data.list.length)
            diagnose('get-recommend-playlists', {
                status: 200,
                receivedEntries: data.list.length,
                skippedEntries: data.list.length - playlists.length,
            });
        return okResult({ playlists, more: data.hasMore });
    }
    catch (error) {
        return failureResult('get-recommend-playlists', error);
    }
};
