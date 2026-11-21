import { parameterStructureOf, requestRouteOf, resultStructureOf, valueStructureOf, } from '../protocol/logStructure.js';
import { AuthCredentialRejectedError } from './authError.js';
import { GatewayCredentialConflictError } from './gatewayCredentialConflictError.js';
import { logger } from './logger.js';
import { RequestRejectedError } from './requestError.js';
import { summarizeError, toLegacyErrorMessage } from './safeError.js';
const MASKED_VALUE = '*** MASKED ***';
const SENSITIVE_KEYS = new Set([
    'authorization',
    'authst',
    'cookie',
    'cookies',
    'musickey',
    'qimei',
    'qimei36',
    'qqmusic_key',
    'qqmusic_uin',
    'token',
    // 账号与设备标识：日志里只需要知道带了这个参数，不需要知道值。
    'access_token',
    'androidid',
    'deviceid',
    'encryptuin',
    'euin',
    'guid',
    'hostuin',
    'imei',
    'loginuin',
    'musicid',
    'openid',
    'qimei16',
    'qm_keyst',
    'refresh_token',
    'str_musicid',
    'udid',
    'uid',
    'uin',
]);
const isPlainObject = (value) => Object.prototype.toString.call(value) === '[object Object]';
// 跨 realm 的 Error 与 DOMException 不一定通过 instanceof，按内部标签一起认。
const isErrorLike = (value) => value instanceof Error ||
    ['[object Error]', '[object DOMException]'].includes(Object.prototype.toString.call(value));
const isSensitiveKey = (key, extras = new Set()) => SENSITIVE_KEYS.has(key.toLowerCase()) || extras.has(key.toLowerCase());
const redactRecord = (value, extras = new Set()) => Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    isSensitiveKey(key, extras) ? MASKED_VALUE : item,
]));
export const summarizeValue = (value) => {
    if (value === null || value === undefined)
        return value;
    // 原始异常的 message、stack、config 都可能带着地址和凭证，日志里只留白名单摘要。
    if (isErrorLike(value))
        return summarizeError(value);
    if (Buffer.isBuffer(value)) {
        return {
            type: 'buffer',
            length: value.length,
        };
    }
    if (isPlainObject(value))
        return resultStructureOf(value);
    return valueStructureOf(value);
};
const compactRecord = (record) => Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined && value !== null));
export const summarizeRequestContext = (ctx) => {
    const requestBody = ctx.request.body;
    const queryExtras = ctx.path.startsWith('/login/qr/') ? new Set(['key']) : new Set();
    const query = redactRecord(ctx.query, queryExtras);
    const requestFields = (value) => Object.fromEntries(Object.entries(value).map(([key, item]) => [
        key,
        isSensitiveKey(key, queryExtras) ? MASKED_VALUE : valueStructureOf(item),
    ]));
    return compactRecord({
        query: Object.keys(query).length ? requestFields(query) : undefined,
        params: Object.keys(ctx.params || {}).length
            ? requestFields(ctx.params)
            : undefined,
        body: requestBody !== undefined ? parameterStructureOf(requestBody) : undefined,
    });
};
export const summarizeResponseBody = (body) => summarizeValue(body);
export const sanitizeRequestUrl = (url) => {
    return requestRouteOf(url);
};
const createControllerMeta = (controller, ctx) => ({
    scope: 'controller',
    controller,
    route: requestRouteOf(ctx.path, ctx._matchedRoute),
    method: ctx.method,
    params: summarizeRequestContext(ctx),
});
const logControllerCompletion = (ctx, baseMeta, startedAt) => {
    const status = ctx.status || 200;
    const meta = {
        ...baseMeta,
        status,
        durationMs: Date.now() - startedAt,
        result: summarizeResponseBody(ctx.body),
    };
    if (status >= 500)
        logger.error('request.failed', meta);
    else if (status >= 400)
        logger.warn('request.validation_failed', meta);
    else
        logger.info('request.succeeded', meta);
};
const handleControllerError = (error, ctx, baseMeta, startedAt) => {
    // 上游明确拒绝凭证是客户端可以自己处理的情况（清掉会话重新登录），不是服务端故障。之前它和其余
    // 异常一样落到 500，客户端只能判成网络错误，于是失效的会话永远清不掉。请求本身不被接受（400）
    // 同理。其余异常行为不变。
    const rejected = error instanceof AuthCredentialRejectedError || error instanceof RequestRejectedError;
    const status = rejected
        ? error.httpStatus
        : error instanceof GatewayCredentialConflictError
            ? error.responseStatus
            : 500;
    const meta = {
        ...baseMeta,
        status,
        durationMs: Date.now() - startedAt,
        error: summarizeError(error),
    };
    // 与 logControllerCompletion 的分级一致：4xx 是警告，5xx 才是错误。
    if (rejected)
        logger.warn('request.validation_failed', meta);
    else
        logger.error('request.failed', meta);
    ctx.status = status;
    if (ctx.body === undefined)
        ctx.body = rejected
            ? { code: status, message: error.message }
            : // 500 仍然用 error 键，但内容只来自固定模板，不再回传原始异常文字。
                { error: toLegacyErrorMessage(error) };
};
export const withControllerLogging = (controller, handler) => async (ctx, next) => {
    const startedAt = Date.now();
    const baseMeta = createControllerMeta(controller, ctx);
    logger.info('request.received', baseMeta);
    try {
        const nextHandler = next || (async () => Promise.resolve());
        await handler(ctx, nextHandler);
        logControllerCompletion(ctx, baseMeta, startedAt);
    }
    catch (error) {
        handleControllerError(error, ctx, baseMeta, startedAt);
    }
};
const createServiceMeta = (service, upstream, params) => compactRecord({
    scope: 'service',
    service,
    upstream,
    params: params === undefined ? undefined : parameterStructureOf(params),
});
export const logServiceRequest = (service, upstream, params, extras = {}) => {
    logger.info('service.requesting', {
        ...createServiceMeta(service, upstream, params),
        ...compactRecord(extras),
    });
};
export const logServiceSuccess = (service, upstream, result, extras = {}) => {
    logger.info('service.succeeded', {
        ...createServiceMeta(service, upstream),
        result: summarizeValue(result),
        ...compactRecord(extras),
    });
};
export const logServiceFailure = (service, upstream, error, params, extras = {}) => {
    logger.error('service.failed', {
        ...createServiceMeta(service, upstream, params),
        error: summarizeValue(error),
        ...compactRecord(extras),
    });
};
export const logServiceBranch = (service, upstream, branch, details = {}) => {
    logger.debug('service.branch_selected', {
        ...createServiceMeta(service, upstream),
        branch,
        ...compactRecord(details),
    });
};
