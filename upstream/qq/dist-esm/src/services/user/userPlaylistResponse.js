import { numberOf } from '../../util/values.js';
/**
 * 与其他路由的 offset 一样宽松：不是正整数（缺少、0、负数、乱码）就当作第一轮，返回 `undefined`，
 * 这样不带参数的调用方（包括 Folia）与以前完全相同。
 */
export const favoriteOffsetOf = (raw) => {
    const value = Number.parseInt(String(raw ?? ''), 10);
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
};
/** 只有 `playCount=1` 才算开启；重复参数只看第一项。 */
export const playCountOf = (raw) => (Array.isArray(raw) ? raw[0] : raw) === '1';
/** 两个参数都没给时回 `undefined`，让不带参数的调用方（包括 Folia）与以前完全相同。 */
export const userPlaylistOptionsOf = (raw, rawPlayCount) => {
    const favoriteOffset = favoriteOffsetOf(raw);
    const playCount = playCountOf(rawPlayCount);
    if (favoriteOffset === undefined && !playCount)
        return undefined;
    return {
        ...(favoriteOffset === undefined ? {} : { favoriteOffset }),
        ...(playCount ? { playCount } : {}),
    };
};
/**
 * `more` 表示列表还不能确认完整；只有读到上限、确实可以接着读时才带 `nextFavoriteOffset`。
 * 空页或重复页停下时 `more` 仍是 `true`，但不给续读位置，免得调用方一直重复同一件事。
 */
export const toUserPlaylistBody = (data) => {
    const playlist = Array.isArray(data.v_playlist) ? data.v_playlist : [];
    const nextFavoriteOffset = numberOf(data.nextFavoriteOffset);
    return {
        code: 200,
        playlist,
        total: typeof data.total === 'number' ? data.total : playlist.length,
        more: data.bFinish === false,
        ...(nextFavoriteOffset !== undefined && Number.isSafeInteger(nextFavoriteOffset)
            ? { nextFavoriteOffset }
            : {}),
        ...(typeof data.playCountComplete === 'boolean'
            ? { playCountComplete: data.playCountComplete }
            : {}),
    };
};
