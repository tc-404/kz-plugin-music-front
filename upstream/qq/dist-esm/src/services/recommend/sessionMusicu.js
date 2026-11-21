import { WEB_ANONYMOUS_COMM, WEB_ANONYMOUS_COMM_WITH_UIN } from '../../protocol/clientProfiles.js';
import { createMusicuClient } from '../../protocol/musicu.js';
import { createFetchTransport } from '../../transport/fetch.js';
import { buildAndroidComm } from '../auth/androidDevice.js';
import { androidRequestHeaders } from '../auth/musicuProtocol.js';
export const createSessionMusicuClient = (session, options = {}) => {
    const http = createFetchTransport(options.fetcher);
    if (!session)
        return createMusicuClient({
            http,
            // 匿名请求用网页端的 comm，和曲库路由一样；2026-10 实测推荐歌单匿名可读。
            comm: options.anonymousUin === 0 ? WEB_ANONYMOUS_COMM_WITH_UIN : WEB_ANONYMOUS_COMM,
        });
    // 和既有的带凭证请求同一套 comm、User-Agent 与 Cookie。
    return createMusicuClient({
        http,
        comm: buildAndroidComm(session.device, session.credential),
        headers: androidRequestHeaders(session.device, session.credential),
        maxRetries: options.maxRetries,
    });
};
