import { normalizeQqFailure, QqApiError } from '../../protocol/errors.js';
import { dictionaryOf, isDictionary } from '../../util/values.js';
import { failureResult, okResult } from '../recommend/newRouteResult.js';
import { createSessionMusicuClient } from '../recommend/sessionMusicu.js';
const stringOf = (value) => (typeof value === 'string' ? value : '');
const countOf = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
/** `page` 只能省略或是 1：上游没有分页参数。 */
const checkPage = (raw) => {
    if (raw !== undefined && raw !== '1')
        throw new QqApiError('input');
};
const singersOf = (value) => (Array.isArray(value) ? value : []).flatMap((item) => {
    const singer = dictionaryOf(item);
    const id = countOf(singer.id);
    return id ? [{ id, mid: stringOf(singer.mid), name: stringOf(singer.name) }] : [];
});
const toMv = (row) => {
    if (!isDictionary(row))
        return null;
    const vid = stringOf(row.vid);
    if (!vid)
        return null;
    const optional = {};
    for (const [key, value] of [
        ['duration', countOf(row.duration)],
        ['playCount', countOf(row.playcount)],
        ['publishDate', countOf(row.publish_date)],
        ['time', countOf(row.time)],
    ])
        if (value !== undefined)
            optional[key] = value;
    return {
        vid,
        mid: stringOf(row.mid),
        name: stringOf(row.mv_name),
        cover: stringOf(row.mv_picurl),
        ...optional,
        singers: singersOf(row.singer),
    };
};
const decodeDictionary = (data) => {
    if (!isDictionary(data))
        throw new QqApiError('invalid-response');
    return data;
};
const favoriteMvs = (encryptedUin) => ({
    module: 'music.musicasset.MVFavRead',
    method: 'getMyFavMV',
    param: { uin: encryptedUin, req_icon_type: 1, support: 1 },
    readOnly: true,
    operation: 'user.favorite-mvs',
    decode: decodeDictionary,
});
/** data 里的 code／subcode 非零是上游拒绝（要在 decode 之后检查，decode 丢的错一律算格式错误）。 */
const innerCodeOf = (data) => {
    for (const key of ['code', 'subcode']) {
        const value = data[key];
        if (value === undefined)
            continue;
        if (typeof value !== 'number' || !Number.isSafeInteger(value))
            throw new QqApiError('invalid-response');
        if (value !== 0)
            throw normalizeQqFailure({ source: 'business', upstreamCode: value });
    }
};
/** 没有收藏回 200 空数组；有条目却一笔都读不出来回 502，不当成「没有」。 */
export const favoriteMvsResult = async (session, rawPage, options = {}) => {
    try {
        if (!session)
            throw new QqApiError('auth-missing');
        checkPage(rawPage);
        const encryptedUin = session.credential.encryptUin;
        if (typeof encryptedUin !== 'string' || !encryptedUin)
            throw new QqApiError('unexpected');
        const data = await createSessionMusicuClient(session, options).execute(favoriteMvs(encryptedUin));
        innerCodeOf(data);
        const list = data.mvlist;
        if (list !== null && list !== undefined && !Array.isArray(list))
            throw new QqApiError('invalid-response');
        const rows = Array.isArray(list) ? list : [];
        const mvs = rows.map(toMv).filter((item) => item !== null);
        if (rows.length && !mvs.length)
            throw new QqApiError('invalid-response');
        return okResult({ mvs, total: countOf(data.total) ?? null, more: data.hasmore === 1 });
    }
    catch (error) {
        return failureResult('get-favorite-mvs', error);
    }
};
