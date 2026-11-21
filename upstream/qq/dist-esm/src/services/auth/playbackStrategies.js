import { ENCRYPTED_PLAYBACK_FILES, fullFilenameOf, previewFilenameOf, } from '../../protocol/playbackFiles.js';
import { stringOf } from '../../util/values.js';
import { callMusicu, callWebPlayerMusicu } from './musicuProtocol.js';
const playbackRequest = ({ http, auth, guid, phase }, items, module, method) => callMusicu(http, auth.device, phase, module, method, {
    filename: items.map((item) => item.filename),
    guid,
    songmid: items.map((item) => item.songmid),
    songtype: items.map(() => 0),
    uin: stringOf(auth.credential.str_musicid) || String(auth.credential.musicid),
    ctx: 0,
}, auth.credential);
const urlGetVkey = (context, items) => playbackRequest(context, items, 'music.vkey.GetVkey', 'UrlGetVkey');
export const encryptedEvKeyStrategy = (quality) => ({
    id: 'encrypted-evkey',
    filenameOf: (songmid, mediaId) => fullFilenameOf(ENCRYPTED_PLAYBACK_FILES[quality], songmid, mediaId),
    request: (context, items) => playbackRequest(context, items, 'music.vkey.GetEVkey', 'CgiGetEVkey'),
});
/** 完整文件：按音质的前缀和扩展名拼两段文件名。 */
export const androidVKeyStrategy = (fileType) => ({
    id: 'android-vkey',
    filenameOf: (songmid, mediaId) => fullFilenameOf(fileType, songmid, mediaId),
    request: urlGetVkey,
});
/** 试听文件：同一个接口，文件名只有 media id 一段。 */
export const previewRs02Strategy = {
    id: 'preview-rs02',
    filenameOf: (_songmid, mediaId) => previewFilenameOf(mediaId),
    request: urlGetVkey,
};
/**
 * 官方网页播放器身份：同一个接口、同样的两段文件名，comm 和标头换成网页播放器那一组，参数照网页多带
 * `loginflag 1`、`platform "20"`。只在安卓身份明确拒绝完整文件时，由备援来用。
 */
export const webSessionVKeyStrategy = (fileType) => ({
    id: 'web-session-vkey',
    filenameOf: (songmid, mediaId) => fullFilenameOf(fileType, songmid, mediaId),
    request: ({ http, auth, guid, phase }, items) => callWebPlayerMusicu(http, phase, 'music.vkey.GetVkey', 'UrlGetVkey', {
        filename: items.map((item) => item.filename),
        guid,
        songmid: items.map((item) => item.songmid),
        songtype: items.map(() => 0),
        uin: stringOf(auth.credential.str_musicid) || String(auth.credential.musicid),
        loginflag: 1,
        platform: '20',
    }, auth.credential),
});
