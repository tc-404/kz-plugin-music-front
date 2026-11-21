// src/protocol/playbackFiles.ts
//
// 取播放链接时要的文件名怎么拼。带会话和匿名两条路用同一份规则，零依赖，两个运行时共用。
/** 各音质对应的文件名前缀和扩展名。 */
export const PLAYBACK_FILE_TYPES = {
    m4a: { prefix: 'C400', extension: '.m4a' },
    128: { prefix: 'M500', extension: '.mp3' },
    320: { prefix: 'M800', extension: '.mp3' },
    ape: { prefix: 'A000', extension: '.ape' },
    flac: { prefix: 'F000', extension: '.flac' },
};
export const ENCRYPTED_PLAYBACK_FILES = {
    '96': { prefix: 'O4M0', extension: '.mgg', codec: 'mgg' },
    '192': { prefix: 'O6M0', extension: '.mgg', codec: 'mgg' },
    flac: { prefix: 'F0M0', extension: '.mflac', codec: 'mflac' },
};
/** 认不出的音质和以前一样退回 128。 */
export const playbackFileTypeOf = (quality) => PLAYBACK_FILE_TYPES[String(quality)] ?? PLAYBACK_FILE_TYPES[128];
/**
 * 完整音质的文件名一律是两段识别值：`前缀 + songmid + media_mid + 扩展名`。没有 media_mid 时用 songmid
 * 补上第二段；只送一段的文件名在取链接时仍会拿到 purl，但 CDN 那边会 403。
 */
export const fullFilenameOf = (type, songmid, mediaId) => `${type.prefix}${songmid}${mediaId || songmid}${type.extension}`;
/**
 * 试听文件：只有一段 14 个字符的 media id，和完整音质的两段文件名不同。不能拿 songmid 代替。
 */
export const previewFilenameOf = (mediaId) => `RS02${mediaId}.mp3`;
const FILE_PREFIXES = {
    ...Object.fromEntries(Object.entries(PLAYBACK_FILE_TYPES).map(([quality, type]) => [
        type.prefix,
        { quality: quality, extension: type.extension },
    ])),
    RS02: { quality: 'preview', extension: '.mp3' },
};
/**
 * 上游给的 purl（文件名加查询参数）是哪一种文件。只认上面几种前缀、而且扩展名要对得上；
 * 认不出（包括测试里的假文件名、加密文件）就回 undefined，不拿要的音质去顶。
 */
export const playbackFileOfPurl = (purl) => {
    const name = purl.split('?')[0];
    const match = /^([A-Z0-9]{4})[A-Za-z0-9]{1,64}(\.[a-z0-9]{2,4})$/.exec(name);
    if (!match)
        return undefined;
    const known = FILE_PREFIXES[match[1]];
    if (!known || known.extension !== match[2])
        return undefined;
    return {
        quality: known.quality,
        codec: known.extension.slice(1),
        encryption: 'none',
    };
};
