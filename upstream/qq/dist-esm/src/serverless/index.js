import { serverlessPathOf, sharedRoutes } from '../routes/manifest.js';
import { loginChannels } from '../routes/operations/loginChannels.js';
import { protectAccountWrite, refusedAccountWrite } from '../routes/operations/writeSafety.js';
import { AUTH_HEADER_NAME, tokenFromCookieString } from '../routes/sessionToken.js';
import { createMemoryDeviceContextRepository } from '../services/auth/deviceContextStore.js';
import { playbackFallbackEnabledOf } from '../services/auth/playbackFallback.js';
import { createQrLoginService, } from '../services/auth/qrLogin.js';
import { setLegacyHttpTransport } from '../services/httpTransport.js';
import { createFetchAuthHttpClient } from '../transport/fetchAuthHttpClient.js';
import { createFetchLegacyTransport } from '../transport/fetchLegacyTransport.js';
import { deriveAndroidDevice } from './derivedDevice.js';
import { operationRequestOf, operationRoute } from './operationRoute.js';
import { CHECK_BUDGET_MS, capabilitiesFor, secretsOf } from './qrRuntime.js';
import { failureResponse, json } from './response.js';
import { createRouter } from './router.js';
import { createSealedSessionResolver } from './sealedResolver.js';
/** A single invocation may observe a pull channel this long before it has to answer. */
/** Header > query > cookie, the same order the Koa controller applies (§5.3 #2). */
const authTokenOf = (request, url) => {
    const header = request.headers.get(AUTH_HEADER_NAME)?.trim();
    if (header)
        return header;
    const queried = tokenFromCookieString(url.searchParams.get('cookie') ?? '');
    if (queried)
        return queried;
    return tokenFromCookieString(request.headers.get('cookie') ?? '');
};
const tokenSourceOf = (request, url) => {
    if (request.headers.get(AUTH_HEADER_NAME)?.trim())
        return 'header';
    if (tokenFromCookieString(url.searchParams.get('cookie') ?? ''))
        return 'query';
    if (tokenFromCookieString(request.headers.get('cookie') ?? ''))
        return 'cookie';
    return undefined;
};
// 路由表由 manifest 生成。/login/channels 在入口最前面单独处理（不注册旧曲库传输、不接异常），
// 不进这张表。
const routes = Object.fromEntries(sharedRoutes
    .filter((route) => route.name !== 'loginChannels')
    .map((route) => [
    serverlessPathOf(route),
    operationRoute(route.accountWrite ? protectAccountWrite(route.handler) : route.handler, route.strictRequest),
]));
const PRIVATE_ROUTES = new Set(sharedRoutes.filter((route) => route.strictRequest && route.needsSecret).map(serverlessPathOf));
const ACCOUNT_WRITE_ROUTES = new Set(sharedRoutes.filter((route) => route.accountWrite).map(serverlessPathOf));
const STRICT_GET_ROUTES = new Set(sharedRoutes
    .filter((route) => route.strictRequest && route.method === 'GET')
    .map((route) => serverlessPathOf(route)));
const NO_SECRET = 'QQ_SESSION_SECRET is not set, so this deployment cannot hold a session. Catalog routes still work.';
/** The routes that need a session secret to mean anything. Catalog routes work without one. */
const LOGIN_ROUTES = new Set(sharedRoutes.filter((route) => route.needsSecret).map((route) => serverlessPathOf(route)));
const match = createRouter(routes);
/**
 * Built per invocation. A Worker may reuse an isolate across requests, and a service holding a
 * cookie jar and QR state from someone else's request is a cross-request leak, not a cache.
 */
const createServiceFor = async (env, options) => {
    const secrets = secretsOf(env);
    return createQrLoginService({
        http: createFetchAuthHttpClient(),
        playbackHintsEnabled: !['0', 'false'].includes(env.QQ_PLAYBACK_HINTS_ENABLED ?? ''),
        playbackFallbackEnabled: playbackFallbackEnabledOf(env.QQ_PLAYBACK_FALLBACK_ENABLED),
        createSessionHttp: () => createFetchAuthHttpClient(),
        deviceRepository: createMemoryDeviceContextRepository(await deriveAndroidDevice(secrets.current)),
        sessionResolver: createSealedSessionResolver({ secrets }),
        capabilities: capabilitiesFor(options, env),
        checkBudgetMs: CHECK_BUDGET_MS,
    });
};
const handleRequestInner = async (request, env = {}, options = {}) => {
    const url = new URL(request.url);
    const configured = Boolean(env.QQ_SESSION_SECRET);
    if (url.pathname === '/login/channels' || url.pathname === '/login/channels/') {
        return operationRoute(loginChannels)({
            url,
            env,
            options,
            params: {},
            token: undefined,
            service: () => createServiceFor(env, options),
        });
    }
    const matched = match(url.pathname);
    if (!matched) {
        return json({
            code: 501,
            message: `${url.pathname} is not implemented by the serverless runtime. See /login/channels for what this deployment serves.`,
        }, 501);
    }
    if (STRICT_GET_ROUTES.has(matched.route) && !['GET', 'HEAD'].includes(request.method))
        return json({ code: 405, message: 'Method Not Allowed' }, 405, { Allow: 'GET, HEAD' });
    if (ACCOUNT_WRITE_ROUTES.has(matched.route)) {
        const refused = refusedAccountWrite(operationRequestOf({
            request,
            url,
            params: matched.params,
            env,
            options,
            token: authTokenOf(request, url),
            tokenSource: tokenSourceOf(request, url),
            service: () => createServiceFor(env, options),
        }));
        if (refused)
            return json(refused.body, refused.status, refused.headers);
    }
    // 🔴 Explicit, never a silent downgrade. Without a secret there is no key to seal a session
    // with, and generating one per isolate would make every login vanish on the next cold start.
    if (!configured && LOGIN_ROUTES.has(matched.route)) {
        return json({ code: 501, message: NO_SECRET }, 501);
    }
    // The legacy catalog transport is a module-level registration, so it is set before any catalog
    // service can run. Re-registering an equivalent transport is idempotent.
    setLegacyHttpTransport(createFetchLegacyTransport());
    // Memoised per invocation: a handler may reach for it more than once, and a Worker isolate is
    // shared across requests, so the service (with its cookie jar and QR state) must not outlive one.
    let pending = null;
    const service = () => {
        pending ??= createServiceFor(env, options);
        return pending;
    };
    try {
        return await matched.handler({
            request,
            url,
            params: matched.params,
            service,
            token: authTokenOf(request, url),
            tokenSource: tokenSourceOf(request, url),
            env,
            options,
        });
    }
    catch (error) {
        return failureResponse(error);
    }
};
export const handleRequest = async (request, env = {}, options = {}) => {
    const matched = match(new URL(request.url).pathname);
    const response = await handleRequestInner(request, env, options);
    if (matched && PRIVATE_ROUTES.has(matched.route))
        response.headers.set('Cache-Control', 'private, no-store');
    return response;
};
export default handleRequest;
