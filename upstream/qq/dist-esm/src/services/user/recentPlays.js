import { normalizeQqFailure, QqApiError } from '../../protocol/errors.js';
import { dictionaryOf, isDictionary } from '../../util/values.js';
import { failureResult, okResult } from '../recommend/newRouteResult.js';
import { createSessionMusicuClient } from '../recommend/sessionMusicu.js';
import { toTrack } from '../recommend/songRelations.js';
const TYPES = {
    song: { code: 2, list: 'songList', toItem: (row) => songOf(row) },
    album: { code: 3, list: 'albumList', toItem: (row) => albumOf(row) },
    playlist: { code: 4, list: 'geDanList', toItem: (row) => playlistOf(row) },
    radio: { code: 5, list: 'radioList', toItem: (row) => radioOf(row) },
    mv: { code: 6, list: 'mvList', toItem: (row) => mvOf(row) },
};
const stringOf = (value) => (typeof value === 'string' ? value : '');
const countOf = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const positiveOf = (value) => {
    const count = countOf(value);
    return count ? count : undefined;
};
/** 只放读得出来的数字字段；`lastTime` 保留上游数值，不推断单位。 */
const numbers = (pairs) => Object.fromEntries(pairs.filter(([, value]) => value !== undefined));
const songOf = (row) => {
    const song = toTrack(row);
    if (!song)
        return null;
    const item = dictionaryOf(row);
    return {
        song,
        ...numbers([
            ['lastTime', countOf(item.lastTime)],
            ['listenCount', countOf(item.listenCnt)],
        ]),
    };
};
const albumOf = (row) => {
    const item = dictionaryOf(row);
    const id = positiveOf(item.id);
    const mid = stringOf(item.mid);
    if (!id && !mid)
        return null;
    return {
        ...numbers([['id', id]]),
        mid,
        name: stringOf(item.name),
        singerName: stringOf(item.singerName),
        ...numbers([['lastTime', countOf(item.lastTime)]]),
    };
};
const playlistOf = (row) => {
    const item = dictionaryOf(row);
    const id = positiveOf(item.id);
    if (!id)
        return null;
    return {
        id,
        ...numbers([['dirId', countOf(item.dirId)]]),
        name: stringOf(item.name),
        cover: stringOf(item.pic),
        creator: stringOf(item.creater),
        ...numbers([
            ['songCount', countOf(item.num)],
            ['lastTime', countOf(item.lastTime)],
        ]),
    };
};
const radioOf = (row) => {
    const item = dictionaryOf(row);
    const id = positiveOf(item.id);
    if (!id)
        return null;
    return {
        id,
        name: stringOf(item.name),
        cover: stringOf(item.pic),
        ...numbers([
            ['radioType', countOf(item.radioType)],
            ['lastTime', countOf(item.lastTime)],
        ]),
    };
};
const mvOf = (row) => {
    const item = dictionaryOf(row);
    const info = dictionaryOf(item.mvInfo);
    const vid = stringOf(info.vid);
    if (!vid)
        return null;
    const singers = (Array.isArray(info.singers) ? info.singers : []).flatMap((value) => {
        const singer = dictionaryOf(value);
        const id = positiveOf(singer.id);
        return id ? [{ id, mid: stringOf(singer.mid), name: stringOf(singer.name) }] : [];
    });
    return {
        vid,
        name: stringOf(info.name),
        cover: stringOf(info.cover_pic),
        singers,
        ...numbers([['lastTime', countOf(item.lastTime)]]),
    };
};
const typeOf = (raw) => {
    if (raw === undefined)
        return 'song';
    if (typeof raw !== 'string' || !Object.hasOwn(TYPES, raw))
        throw new QqApiError('input');
    return raw;
};
const decodeDictionary = (data) => {
    if (!isDictionary(data))
        throw new QqApiError('invalid-response');
    return data;
};
const recentPlays = (code) => ({
    module: 'music.musicasset.PlayRecentlyRead',
    method: 'GetPlayRecentlyInfo',
    param: { type: code, updateTime: 0 },
    readOnly: true,
    operation: 'user.recent-plays',
    decode: decodeDictionary,
});
/** data 里的 code 非零是上游拒绝（decode 之后检查：decode 丢的错一律算格式错误）。 */
const rowsOf = (data, list) => {
    const { code } = data;
    if (code !== undefined) {
        if (typeof code !== 'number' || !Number.isSafeInteger(code))
            throw new QqApiError('invalid-response');
        // 验收观察：-300 与该类没有记录相符，但还未直接证实。
        if (code === -300) {
            if (data.data == null)
                return [];
            if (!isDictionary(data.data))
                throw new QqApiError('invalid-response');
            const rows = data.data[list];
            if (rows == null || (Array.isArray(rows) && rows.length === 0))
                return [];
        }
        if (code !== 0)
            throw normalizeQqFailure({ source: 'business', upstreamCode: code });
    }
    if (!isDictionary(data.data))
        throw new QqApiError('invalid-response');
    const rows = data.data[list];
    if (rows === null || rows === undefined)
        return [];
    if (!Array.isArray(rows))
        throw new QqApiError('invalid-response');
    return rows;
};
/** 没播过回 200 空数组；有条目却一条都读不出来回 502，不当成「没有」。 */
export const recentPlaysResult = async (session, rawType, options = {}) => {
    try {
        if (!session)
            throw new QqApiError('auth-missing');
        const type = typeOf(rawType);
        const spec = TYPES[type];
        const data = await createSessionMusicuClient(session, options).execute(recentPlays(spec.code));
        const rows = rowsOf(data, spec.list);
        const items = rows.map(spec.toItem).filter((item) => item !== null);
        if (rows.length && !items.length)
            throw new QqApiError('invalid-response');
        return okResult({ type, items, total: items.length });
    }
    catch (error) {
        return failureResult('get-recent-plays', error);
    }
};
