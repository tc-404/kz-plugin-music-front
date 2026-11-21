import { QqApiError } from '../../protocol/errors.js';
import { dictionaryOf } from '../../util/values.js';
import { failureResult } from './newRouteResult.js';
import { radarResult } from './radar.js';
// 私人 FM 的会话与续批边界；上游协议和曲目解析复用 radar，不改变匿名雷达的旧契约。
export const personalFmResult = async (session, rawPage, options = {}) => {
    try {
        if (!session)
            throw new QqApiError('auth-missing');
        if (rawPage !== undefined &&
            (typeof rawPage !== 'string' || !/^(?:[1-9]\d?|100)$/.test(rawPage)))
            throw new QqApiError('input');
        const page = rawPage === undefined ? 1 : Number(rawPage);
        // 超时后上游可能已交出一批；不自动重发，也不在服务端保存或推进跨请求的序列。
        const result = await radarResult(session, page, { ...options, maxRetries: 0 });
        if (result.status !== 200)
            return result;
        const body = dictionaryOf(result.body);
        return {
            ...result,
            body: {
                ...body,
                station: 'personal-fm',
                ...(body.more === true
                    ? page < 100
                        ? { nextPage: page + 1 }
                        : { paginationLimitReached: true }
                    : {}),
            },
        };
    }
    catch (error) {
        return failureResult('get-radar', error);
    }
};
