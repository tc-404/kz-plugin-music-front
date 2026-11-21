// src/protocol/playbackDiagnostics.ts
//
// 取不到播放链接时，只从单曲条目（取链接响应里的 `midurlinfo[i]`）挑登记过的数字字段留作证据。
// 这些数字的含义还没有实测，这里只收集、不解释；对外回应不受影响。零依赖，两个运行时共用。
/** 单曲条目里可能带失败原因的数字字段。不在这里的字段一律不收。 */
export const PLAYBACK_ENTRY_CODE_FIELDS = ['result', 'errtype', 'code', 'subcode'];
/** 安全整数照收；纯数字字符串（上游有时把码写成字符串）换成整数；其他一律丢掉。 */
const safeIntegerOf = (value) => {
    if (typeof value === 'number')
        return Number.isSafeInteger(value) ? value : undefined;
    if (typeof value !== 'string' || !/^-?\d{1,15}$/.test(value))
        return undefined;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
};
const read = (item, key) => {
    try {
        return item && typeof item === 'object' ? item[key] : undefined;
    }
    catch {
        return undefined;
    }
};
export const playbackEntryCodesOf = (item) => {
    const codes = {};
    for (const field of PLAYBACK_ENTRY_CODE_FIELDS) {
        const value = safeIntegerOf(read(item, field));
        if (value !== undefined)
            codes[field] = value;
    }
    return codes;
};
/**
 * `playback.url-unavailable` 开发日志（debug）的内容：阶段、在请求里的位置、音质和单曲条目的安全错码。
 * 不带歌曲 id、链接、文件名、提示文字或凭证；要知道是哪一首，用 `index` 对回请求。
 */
export const playbackUnavailableLogOf = (where) => ({
    phase: where.phase,
    index: where.index,
    quality: where.quality,
    entryCodes: playbackEntryCodesOf(where.entry),
});
