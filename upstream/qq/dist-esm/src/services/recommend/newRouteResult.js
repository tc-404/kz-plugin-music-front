import { QqApiError, toNewRouteErrorResponse } from '../../protocol/errors.js';
import { logger } from '../../util/logger.js';
import { summarizeError } from '../../util/safeError.js';
export const okResult = (body) => ({
    status: 200,
    headers: {},
    body: { code: 200, ...body },
});
/** 错误核心已经验证过的数字字段；诊断只取这几个。 */
const SAFE_NUMBER_KEYS = [
    'upstreamCode',
    'upstreamGlobalCode',
    'upstreamSubCode',
    'upstreamHttpStatus',
    'retryAfterMs',
];
/**
 * 开发诊断：debug 级别，平时看不到，LOG_LEVEL=debug 才输出。
 * 只放 phase、状态码、errorKey 和安全整数，不放凭证、账号 id、网址或上游原文。
 */
export const diagnose = (phase, details) => {
    logger.debug('recommend.request-diagnostic', { phase, ...details });
};
/**
 * 对外只给一般化的文字。5xx 与 429 写一条 warn；401、422 这类预期中的结果只写 debug 诊断，
 * 同一个失败不重复记。
 */
export const failureResult = (phase, error) => {
    const response = toNewRouteErrorResponse(error);
    if (response.status >= 500 || response.status === 429) {
        logger.warn('recommend.request-failed', {
            phase,
            ...(error instanceof QqApiError ? error.toJSON() : summarizeError(error)),
        });
        return response;
    }
    const numbers = {};
    for (const key of SAFE_NUMBER_KEYS) {
        const value = response.body[key];
        if (typeof value === 'number' && Number.isSafeInteger(value))
            numbers[key] = value;
    }
    diagnose(phase, { status: response.status, errorKey: response.body.errorKey, ...numbers });
    return response;
};
