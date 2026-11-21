import { QqApiError, toNewRouteErrorResponse } from '../../protocol/errors.js';
/**
 * 新写入只收 `application/json`。跨站页面不经预检就能发出的只有表单和纯文本，带着 Cookie 也写不进来；
 * 这里不开放带凭证的 CORS，JSON 请求要过预检，别的来源发不出。旧写入路由照旧，不改它们的契约。
 */
export const jsonRequired = (request) => /^application\/json\s*(;|$)/i.test(request.contentType?.trim() ?? '')
    ? null
    : {
        status: 415,
        headers: { Accept: 'application/json' },
        body: { code: 415, message: 'application/json required' },
    };
/** 已经真账号写后读回验收过的写入：只要 POST 和有效会话，不看实验开关。 */
export const sessionWrite = (execute) => async (request) => {
    if (request.method !== 'POST')
        return {
            status: 405,
            headers: { Allow: 'POST' },
            body: { code: 405, message: 'POST required' },
        };
    const unsupportedType = jsonRequired(request);
    if (unsupportedType)
        return unsupportedType;
    const session = await (await request.service()).resolveSession(request.token);
    if (!session)
        return toNewRouteErrorResponse(new QqApiError('auth-missing'));
    let body;
    try {
        body = await request.body?.();
    }
    catch {
        return toNewRouteErrorResponse(new QqApiError('input'));
    }
    return execute(session, body);
};
/** 真账号双向验证前，只允许可信宿主明确开启的测试入口。 */
export const unverifiedWrite = (execute) => async (request) => {
    if (request.method === 'POST' && !request.unverifiedWritesEnabled)
        return toNewRouteErrorResponse(new QqApiError('feature-unavailable'));
    return sessionWrite(execute)(request);
};
