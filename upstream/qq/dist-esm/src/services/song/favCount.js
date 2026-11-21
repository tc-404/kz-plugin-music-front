import { WEB_ANONYMOUS_COMM_WITH_UIN } from '../../protocol/clientProfiles.js';
import { QqApiError } from '../../protocol/errors.js';
import { createMusicuClient } from '../../protocol/musicu.js';
import { createFetchTransport } from '../../transport/fetch.js';
import { isDictionary } from '../../util/values.js';
import { failureResult, okResult } from '../recommend/newRouteResult.js';
import { songIdOf } from './readValues.js';
const mapOf = (raw) => {
    if (raw === undefined || raw === null)
        return {};
    if (!isDictionary(raw))
        throw new QqApiError('invalid-response');
    return raw;
};
export const songFavCountResult = async (raw) => {
    try {
        if (typeof raw !== 'string')
            throw new QqApiError('input');
        const source = raw.split(',');
        if (source.length < 1 || source.length > 20)
            throw new QqApiError('input');
        const ids = source.map(songIdOf);
        const client = createMusicuClient({
            http: createFetchTransport(),
            comm: WEB_ANONYMOUS_COMM_WITH_UIN,
            maxRetries: 0,
        });
        const data = await client.execute({
            module: 'music.musicasset.SongFavRead',
            method: 'GetSongFansNumberById',
            param: { v_songId: [...new Set(ids)] },
            readOnly: true,
        });
        if (!isDictionary(data))
            throw new QqApiError('invalid-response');
        const numbers = mapOf(data.m_numbers);
        const displays = mapOf(data.m_show);
        const items = ids.map((id) => {
            const count = numbers[String(id)] ?? null;
            const display = displays[String(id)] ?? null;
            if (count !== null &&
                (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0))
                throw new QqApiError('invalid-response');
            if (display !== null && typeof display !== 'string')
                throw new QqApiError('invalid-response');
            return { id, count, display };
        });
        if (items.every((item) => item.count === null && item.display === null))
            throw new QqApiError('not-found');
        return okResult({ items });
    }
    catch (error) {
        return failureResult('get-song-fav-count', error);
    }
};
