import { QqApiError } from '../../protocol/errors.js';
import { dictionaryOf, isDictionary } from '../../util/values.js';
import { failureResult, okResult } from './newRouteResult.js';
import { createSessionMusicuClient } from './sessionMusicu.js';
// src/services/recommend/songLabels.ts
//
// `/song/labels`：一首歌的标签，公开内容，一律匿名读，带了会话也不用。Node 与 serverless 共用。
// 实测（2026-10，匿名网页 comm）：`TrackRelationServer.GetSongLabels { songid }` → `labels[]`
// （`id`、`species`、`tagType`、`tagTxt`、`tagIcon`、`tagUrl`）。
const ID_PATTERN = /^\d{1,15}$/;
const textOf = (value) => typeof value === 'string' && value.length > 0 ? value : undefined;
const countOf = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
/** 标签 id 上游可能是数字也可能是字符串，原样保留，其他型别不给。 */
const labelIdOf = (value) => typeof value === 'number' && Number.isSafeInteger(value) ? value : textOf(value);
/** 只认纯数字的正整数歌曲 id。 */
const songIdOf = (raw) => {
    const text = String(raw ?? '');
    const value = ID_PATTERN.test(text) ? Number(text) : 0;
    if (!Number.isSafeInteger(value) || value <= 0)
        throw new QqApiError('input');
    return value;
};
const toLabel = (entry) => {
    const item = dictionaryOf(entry);
    const text = textOf(item.tagTxt);
    if (text === undefined)
        return null;
    const optional = [
        ['id', labelIdOf(item.id)],
        ['type', countOf(item.tagType)],
        ['icon', textOf(item.tagIcon)],
        ['url', textOf(item.tagUrl)],
    ];
    return { text, ...Object.fromEntries(optional.filter(([, value]) => value !== undefined)) };
};
/** 没有标签回 422；给了标签却一个都读不出来回 502。 */
export const songLabelsResult = async (rawId, options = {}) => {
    try {
        const id = songIdOf(rawId);
        const data = await createSessionMusicuClient(null, options).execute({
            module: 'music.recommend.TrackRelationServer',
            method: 'GetSongLabels',
            param: { songid: id },
            readOnly: true,
            operation: 'song.labels',
            decode: (value) => {
                if (!isDictionary(value))
                    throw new QqApiError('invalid-response');
                return value;
            },
        });
        const { labels: raw } = data;
        if (raw !== null && raw !== undefined && !Array.isArray(raw))
            throw new QqApiError('invalid-response');
        const entries = Array.isArray(raw) ? raw : [];
        if (!entries.length)
            throw new QqApiError('not-found');
        const labels = entries.map(toLabel).filter(Boolean);
        if (!labels.length)
            throw new QqApiError('invalid-response');
        return okResult({ id, labels });
    }
    catch (error) {
        return failureResult('get-song-labels', error);
    }
};
