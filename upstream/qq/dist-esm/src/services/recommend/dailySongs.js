import { QqApiError } from '../../protocol/errors.js';
import { isDictionary } from '../../util/values.js';
import { failureResult, okResult } from './newRouteResult.js';
import { createSessionMusicuClient } from './sessionMusicu.js';
const decode = (data) => {
    if (!isDictionary(data))
        throw new QqApiError('invalid-response');
    // 实测成功时内层 code、subcode 都是 0；非 0 的意思没有分离，不当成功也不当凭证失效。
    if (data.code !== undefined && data.code !== 0)
        throw new QqApiError('invalid-response');
    const { songlist } = data;
    if (songlist !== null && songlist !== undefined && !Array.isArray(songlist))
        throw new QqApiError('invalid-response');
    return { songs: Array.isArray(songlist) ? songlist : [] };
};
export const DAILY_SONGS = {
    module: 'music.srfDissInfo.aiDissInfo',
    method: 'uniform_get_Dissinfo',
    param: { dirid: 202, optype: 3, tag: 1, userinfo: 0, pic_dpi: 300 },
    readOnly: true,
    operation: 'recommend.daily-songs',
    decode,
};
/** 没有会话回 401；上游成功但没有歌回 422。歌曲条目原样交出去，由前端自己正规化。 */
export const dailySongsResult = async (session, options = {}) => {
    try {
        if (!session)
            throw new QqApiError('auth-missing');
        const data = await createSessionMusicuClient(session, options).execute(DAILY_SONGS);
        if (!data.songs.length)
            throw new QqApiError('not-found');
        return okResult({ songs: data.songs });
    }
    catch (error) {
        return failureResult('get-daily-songs', error);
    }
};
