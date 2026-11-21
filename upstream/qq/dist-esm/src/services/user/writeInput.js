import { QqApiError } from '../../protocol/errors.js';
import { isDictionary } from '../../util/values.js';
export const positiveIntegerOf = (value) => {
    const number = typeof value === 'string' && /^\d{1,15}$/.test(value) ? Number(value) : value;
    return typeof number === 'number' && Number.isSafeInteger(number) && number > 0
        ? number
        : undefined;
};
export const exactObjectOf = (value, keys) => {
    if (!isDictionary(value) || Object.keys(value).some((key) => !keys.includes(key)))
        throw new QqApiError('input');
    return value;
};
/** 已确认的曲库输入编码器。以后新增类型需独立验证编码，不沿用读取条目的 type/songtype。 */
const SONG_ENCODERS = new Map([[0, (id) => ({ songId: id, songType: 0 })]]);
export const playlistSongOf = (value) => {
    const input = exactObjectOf(value, ['id', 'type']);
    const id = positiveIntegerOf(input.id);
    const encoder = typeof input.type === 'number' ? SONG_ENCODERS.get(input.type) : undefined;
    if (id === undefined || !encoder)
        throw new QqApiError('input');
    return encoder(id);
};
