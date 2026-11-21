/** 日志只留结构与白名单数字，不保留参数值、正文或动态响应键。两个宿主可共用。 */
export const valueStructureOf = (value) => {
    if (value === null || value === undefined)
        return value;
    if (Array.isArray(value))
        return { type: 'array', count: value.length };
    if (typeof value === 'object')
        return { type: 'object', count: Object.keys(value).length };
    if (typeof value === 'string')
        return { type: 'string', length: value.length, count: value ? value.split(',').length : 0 };
    return { type: typeof value };
};
export const parameterStructureOf = (value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, valueStructureOf(item)]))
    : valueStructureOf(value);
const STATIC_ROUTES = new Set([
    '/user/detail',
    '/user/vip',
    '/user/playlist',
    '/user/albums',
    '/user/liked-songs',
    '/user/playlist-detail',
    '/user/guess-you-like',
    '/user/daily-songs',
    '/user/cloud',
    '/recommend/playlists',
    '/recommend/categories',
    '/recommend/category-playlists',
    '/recommend/new-songs',
    '/recommend/new-albums',
    '/recommend/radar',
    '/song/similar',
    '/song/related-playlists',
    '/recommend/toplists',
    '/recommend/toplist',
    '/search',
    '/search/hot',
    '/search/suggest',
    '/singer/list',
    '/singer/detail',
    '/singer/homepage',
    '/singer/similar',
    '/singer/songs',
    '/singer/mvs',
    '/comment/hot',
    '/comment/new',
    '/comment/count',
    '/mv/list',
    '/mv/detail',
    '/mv/url',
    '/song/mvs',
    '/song/labels',
    '/radio/list',
    '/radio/tracks',
    '/login/qr/key',
    '/login/qr/create',
    '/login/qr/check',
    '/login/qr/cancel',
    '/login/status',
    '/login/channels',
    '/logout',
    '/user/playlist/create',
    '/user/playlist/rename',
    '/user/playlist/delete',
    '/user/playlist/tracks',
    '/user/playlist/subscribe',
    '/user/subscription-status',
]);
const CATALOG_ROUTES = new Set([
    'getSongInfo',
    'getSongListDetail',
    'getSingerAlbum',
    'getSingerHotsong',
    'getLyric',
    'getMusicPlay',
    'getAlbumInfo',
]);
export const requestRouteOf = (input, matchedRoute) => {
    if (matchedRoute)
        return matchedRoute.replace(/\?/g, '');
    const path = new URL(input, 'http://qq-music-api.local').pathname.replace(/\/$/, '') || '/';
    if (STATIC_ROUTES.has(path))
        return path;
    const [, root, ...parts] = path.split('/');
    if (!CATALOG_ROUTES.has(root))
        return '/:unmatched';
    if (!parts.length)
        return `/${root}`;
    const first = root === 'getMusicPlay' || root === 'getSongInfo' || root === 'getLyric' ? 'songmid' : 'param';
    return `/${root}/:${first}${parts
        .slice(1)
        .map(() => '/:param')
        .join('')}`;
};
export const upstreamRouteOf = (input) => {
    const path = new URL(input, 'http://qq-music-api.local').pathname;
    return /^\/(?:cgi-bin|splcloud)\/[A-Za-z0-9_./-]+\.(?:fcg|cgi)$/.test(path) ? path : '/:upstream';
};
export const resultStructureOf = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return valueStructureOf(value);
    const record = value;
    const codes = Object.fromEntries(['code', 'result', 'subcode', 'errtype', 'status', 'total', 'retryAfterMs'].flatMap((key) => {
        const item = record[key];
        return typeof item === 'number' && Number.isSafeInteger(item) ? [[key, item]] : [];
    }));
    return { type: 'object', count: Object.keys(record).length, ...codes };
};
export const legacyRequestStructureOf = (url, method, options) => {
    const params = options.params && typeof options.params === 'object'
        ? options.params
        : {};
    let payload = params.data ?? options.data;
    try {
        if (typeof payload === 'string')
            payload = JSON.parse(payload);
    }
    catch {
        payload = undefined;
    }
    const rpc = payload && typeof payload === 'object'
        ? Object.entries(payload)
            .filter(([key]) => key !== 'comm')
            .flatMap(([, item]) => {
            if (!item || typeof item !== 'object')
                return [];
            const call = item;
            if (typeof call.module !== 'string' || typeof call.method !== 'string')
                return [];
            return [
                {
                    module: call.module,
                    method: call.method,
                    params: parameterStructureOf(call.param),
                },
            ];
        })
        : [];
    return {
        route: upstreamRouteOf(url),
        method,
        params: parameterStructureOf(params),
        ...(rpc.length ? { rpc } : {}),
    };
};
