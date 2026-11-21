import { AUTH_HEADER_NAME, tokenFromCookieString } from '../routes/sessionToken.js';
import qrLoginService from '../services/auth/qrLogin.node.js';
import { getAuthToken } from './login.js';
// src/controllers/operation.ts
//
// Koa 这边的转接：把 ctx 整理成共用 handler 要的请求，再把结果写回 ctx。不做别的事，
// 日志和异常照旧由 `withControllerLogging` 处理。
const firstOf = (value) => Array.isArray(value) ? value[0] : value;
export const operationRequestOf = (ctx, signal) => ({
    runtime: 'node',
    signal,
    unverifiedWritesEnabled: process.env.QQ_UNVERIFIED_WRITES_ENABLED === '1',
    method: ctx.method,
    body: async () => ctx.request.body,
    get contentType() {
        return ctx.get('content-type') || undefined;
    },
    query: (name) => firstOf(ctx.query[name]),
    queryRaw: (name) => ctx.query[name],
    params: ctx.params ?? {},
    // 用到才读：原来的 controller 不碰 header 和 cookie 的，转接也不先去碰。
    get token() {
        return getAuthToken(ctx);
    },
    get tokenSource() {
        if (ctx.get(AUTH_HEADER_NAME).trim())
            return 'header';
        if (tokenFromCookieString(String(ctx.query.cookie ?? '')))
            return 'query';
        return ctx.cookies.get('qqmusic_session') ? 'cookie' : undefined;
    },
    get fetchSite() {
        return ctx.get('sec-fetch-site') || undefined;
    },
    service: async () => qrLoginService,
});
export const operationController = (handler, abortOnDisconnect = false) => async (ctx) => {
    if (!abortOnDisconnect) {
        const result = await handler(operationRequestOf(ctx));
        ctx.status = result.status;
        for (const [name, value] of Object.entries(result.headers))
            ctx.set(name, value);
        ctx.body = result.body;
        return;
    }
    const abort = new AbortController();
    const close = () => {
        if (!ctx.res.writableFinished)
            abort.abort();
    };
    ctx.res.once('close', close);
    try {
        const result = await handler(operationRequestOf(ctx, abort.signal));
        ctx.status = result.status;
        for (const [name, value] of Object.entries(result.headers))
            ctx.set(name, value);
        ctx.body = result.body;
    }
    finally {
        ctx.res.removeListener('close', close);
    }
};
