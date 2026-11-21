import { PLAYBACK_HINT_MESSAGES } from './playbackHints.js';
import { classifyPlaybackRestriction } from './playbackRestriction.js';
/** 只守门 ape。缺少可靠数字与确认没文件分开；不从错误码猜文件是否存在。 */
export const apeFileFailureOf = (track) => {
    const file = track && typeof track === 'object' ? track.file : undefined;
    const raw = file && typeof file === 'object' ? file.size_ape : undefined;
    const size = typeof raw === 'string' && /^\d{1,15}$/.test(raw) ? Number(raw) : raw;
    if (typeof size !== 'number' || !Number.isSafeInteger(size))
        return 'quality-detail-unavailable';
    return size > 0 ? undefined : 'quality-file-unavailable';
};
export const qualityFileRestriction = (authenticated, failureReason) => {
    const key = failureReason === 'quality-file-unavailable'
        ? 'playback.quality-file-unavailable'
        : 'playback.quality-detail-unavailable';
    return {
        ...classifyPlaybackRestriction({ authenticated, quality: 'ape', codes: {} }),
        failureReason,
        hint: { key, message: PLAYBACK_HINT_MESSAGES[key] },
    };
};
/** quality=best 依次尝试的音质，和 Folia 的回退顺序一致。 */
export const BEST_QUALITY_ORDER = ['flac', '320', '128'];
const sizeOf = (file, key) => {
    const raw = file && typeof file === 'object' ? file[key] : undefined;
    const size = typeof raw === 'string' && /^\d{1,15}$/.test(raw) ? Number(raw) : raw;
    return typeof size === 'number' && Number.isSafeInteger(size) ? size : undefined;
};
/**
 * quality=best 这首歌要试哪些音质：详情里 size_flac、size_320mp3 大于 0 才试那一级，128 一定是最后一级。
 * 详情读不到（undefined）或数字不可靠时只试 128，不猜文件。
 */
export const bestQualityLevelsOf = (track) => {
    const file = track && typeof track === 'object' ? track.file : undefined;
    return [
        ...((sizeOf(file, 'size_flac') ?? 0) > 0 ? ['flac'] : []),
        ...((sizeOf(file, 'size_320mp3') ?? 0) > 0 ? ['320'] : []),
        '128',
    ];
};
