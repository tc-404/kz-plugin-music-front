import { QqApiError } from '../../protocol/errors.js';
import { dictionaryOf, isDictionary } from '../../util/values.js';
import { failureResult, okResult } from '../recommend/newRouteResult.js';
import { createSessionMusicuClient } from '../recommend/sessionMusicu.js';
/** 必填的歌曲 id：只认纯数字的正整数，和 `/song/similar` 一样。 */
const songIdOf = (raw) => {
    const text = typeof raw === 'string' ? raw : '';
    const value = /^\d{1,15}$/.test(text) ? Number(text) : Number.NaN;
    if (!Number.isSafeInteger(value) || value <= 0)
        throw new QqApiError('input');
    return value;
};
/** null／缺省是没有流派；其他非数组是格式变了。 */
const genreRowsOf = (data) => {
    if (!isDictionary(data))
        throw new QqApiError('invalid-response');
    const rows = data.genres;
    if (rows === null || rows === undefined)
        return [];
    if (!Array.isArray(rows))
        throw new QqApiError('invalid-response');
    return rows;
};
const toGenre = (row) => {
    const item = dictionaryOf(row);
    const { id, name } = item;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0)
        return null;
    if (typeof name !== 'string' || !name)
        return null;
    return { id, name };
};
const songGenre = (songid) => ({
    module: 'music.recommend.TrackRelationServer',
    method: 'GetSongGenre',
    param: { songid },
    readOnly: true,
    operation: 'song.genre',
    decode: genreRowsOf,
});
/** 没有流派回 200 空数组；有条目却一个都读不出来回 502，不当成「没有」。 */
export const songGenreResult = async (session, rawId, options = {}) => {
    try {
        if (!session)
            throw new QqApiError('auth-missing');
        const songid = songIdOf(rawId);
        const rows = await createSessionMusicuClient(session, options).execute(songGenre(songid));
        const genres = rows.map(toGenre).filter((item) => item !== null);
        if (rows.length && !genres.length)
            throw new QqApiError('invalid-response');
        return okResult({ genres });
    }
    catch (error) {
        return failureResult('get-song-genre', error);
    }
};
