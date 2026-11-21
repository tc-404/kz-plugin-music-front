import { readCgi } from '../../protocol/cgi.js';
import { QqApiError } from '../../protocol/errors.js';
import { defaultTokenBucket } from '../../protocol/tokenBucket.js';
import { createFetchCgiTransport } from '../../transport/fetchCgi.js';
import { failureResult } from '../recommend/newRouteResult.js';
export const objectOf = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new QqApiError('invalid-response');
    return value;
};
export const arrayOf = (value) => {
    if (!Array.isArray(value))
        throw new QqApiError('invalid-response');
    return value;
};
export const countOf = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
export const textOf = (value) => (typeof value === 'string' ? value : '');
export const integerOf = (raw, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) => {
    if (raw === undefined && fallback !== undefined)
        return fallback;
    const text = typeof raw === 'string' || typeof raw === 'number' ? String(raw) : '';
    const value = /^\d+$/.test(text) ? Number(text) : Number.NaN;
    if (!Number.isSafeInteger(value) || value < min || value > max)
        throw new QqApiError('input');
    return value;
};
/** 只保留已确认的标量字段，不交出账号标识、追踪信息或未知对象。 */
export const fieldsOf = (value, names) => Object.fromEntries(names
    .filter((key) => typeof value[key] === 'string' ||
    typeof value[key] === 'boolean' ||
    (typeof value[key] === 'number' && Number.isFinite(value[key])))
    .map((key) => [key, value[key]]));
export const anonymousResult = async (phase, run) => {
    try {
        return await run();
    }
    catch (error) {
        return failureResult(phase, error);
    }
};
/** 匿名旧 CGI 读取走协议层：一次请求、25 秒截止，和 musicu 共用令牌桶；不经过旧曲库的全局传输槽，不发送会话。 */
export const readAnonymousCgi = (path, params, operation) => readCgi('https://c.y.qq.com', path, params, {
    operation,
    http: createFetchCgiTransport(),
    limiter: defaultTokenBucket,
});
