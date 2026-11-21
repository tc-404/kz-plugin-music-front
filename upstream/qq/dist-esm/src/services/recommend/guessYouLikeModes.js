import { QqApiError } from '../../protocol/errors.js';
import { isDictionary } from '../../util/values.js';
import { failureResult, okResult } from './newRouteResult.js';
import { createSessionMusicuClient } from './sessionMusicu.js';
// 猜你喜欢（id 99）的单选听歌模式目录；只读 RadioConfig，不写设置，也不解释状态、时间字段的含义。
const MAX_ITEMS = 256;
const listOf = (value, optional = false) => {
    if (optional && value === undefined)
        return [];
    if (!Array.isArray(value) || value.length > MAX_ITEMS)
        throw new QqApiError('invalid-response');
    return value;
};
const idOf = (value) => {
    if (typeof value !== 'string' || !value || value.length > 64)
        throw new QqApiError('invalid-response');
    return value;
};
const modesOf = (value, optional = false) => {
    const seen = new Set();
    return listOf(value, optional).map((entry) => {
        if (!isDictionary(entry) || typeof entry.Name !== 'string' || typeof entry.Pic !== 'string')
            throw new QqApiError('invalid-response');
        const id = idOf(entry.Id);
        if (seen.has(id))
            throw new QqApiError('invalid-response');
        seen.add(id);
        const ext = entry.Ext;
        if (ext !== undefined && !isDictionary(ext))
            throw new QqApiError('invalid-response');
        const poolId = ext?.pool_id;
        if (poolId !== undefined && (typeof poolId !== 'string' || !poolId))
            throw new QqApiError('invalid-response');
        // pool 只给取歌端对照，和普通雷达 radio ID、偏好 key 不能互换。
        return { id, name: entry.Name, cover: entry.Pic, ...(poolId ? { poolId } : {}) };
    });
};
export const guessYouLikeModesResult = async (session, unsupportedQuery) => {
    try {
        if (!session)
            throw new QqApiError('auth-missing');
        if (unsupportedQuery)
            throw new QqApiError('input');
        const data = await createSessionMusicuClient(session, { maxRetries: 0 }).execute({
            module: 'music.startup.RadioConfig',
            method: 'GetRadioSceneConfigs',
            // 2026-11 实测：Android comm 送空参数即可读回完整目录。
            param: {},
            readOnly: true,
            operation: 'recommend.guess-you-like-modes',
        });
        if (!isDictionary(data))
            throw new QqApiError('invalid-response');
        const primaryModes = modesOf(data.TopConfigList);
        const scenes = modesOf(data.ConfigList);
        const recommended = modesOf(data.RecConfigList, true);
        const selectedIds = listOf(data.SelectConfigList, true).map((entry) => {
            if (!isDictionary(entry))
                throw new QqApiError('invalid-response');
            return idOf(entry.Id);
        });
        if (!primaryModes.length && !scenes.length)
            throw new QqApiError('not-found');
        return okResult({
            station: 'guess-you-like',
            radioId: 99,
            selection: 'single',
            primaryModes,
            scenes,
            recommended,
            selectedIds,
        });
    }
    catch (error) {
        return failureResult('get-guess-you-like-modes', error);
    }
};
