import { normalizeQqFailure, QqApiError } from './errors.js';
import { withDeadline } from './http.js';
/** 传输层观察到的网络失败：只留原生错误的 name 和 code，不带原文、网址或凭证。 */
export class CgiNetworkError extends Error {
    nativeName;
    code;
    constructor(observation) {
        super('CGI transport failed');
        this.name = 'CgiNetworkError';
        this.nativeName = observation.name;
        this.code = observation.code;
    }
}
const networkFailure = (error, operation) => {
    if (error instanceof QqApiError)
        return error;
    const observed = error instanceof CgiNetworkError ? { name: error.nativeName, code: error.code } : error;
    return normalizeQqFailure({ source: 'network', error: observed }, { operation, readOnly: true });
};
const decode = (bytes) => {
    try {
        let text;
        try {
            text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        }
        catch {
            text = new TextDecoder('gb18030', { fatal: true }).decode(bytes);
        }
        const jsonp = /^\w+\(([\s\S]*)\);?\s*$/.exec(text);
        return JSON.parse(jsonp ? jsonp[1] : text);
    }
    catch {
        throw new QqApiError('invalid-response');
    }
};
const checked = (body, operation) => {
    if (!body || typeof body !== 'object' || Array.isArray(body))
        throw new QqApiError('invalid-response');
    const data = body;
    if (typeof data.code !== 'number' || !Number.isSafeInteger(data.code))
        throw new QqApiError('invalid-response');
    if (data.code !== 0)
        throw normalizeQqFailure({ source: 'business', upstreamCode: data.code }, { operation });
    if (data.subcode !== undefined) {
        if (typeof data.subcode !== 'number' || !Number.isSafeInteger(data.subcode))
            throw new QqApiError('invalid-response');
        if (data.subcode !== 0)
            throw normalizeQqFailure({ source: 'business', upstreamCode: data.subcode }, { operation });
    }
    return data;
};
/** 读一次，不重试；`origin` 加 `path` 是上游地址，`params` 之外固定带 `format=json&outCharset=utf-8`。 */
export const readCgi = (origin, path, params, options) => {
    const { operation } = options;
    const url = new URL(path, origin);
    url.search = new URLSearchParams(Object.entries({
        format: 'json',
        outCharset: 'utf-8',
        ...params,
    }).map(([key, value]) => [key, String(value)])).toString();
    return withDeadline(async (signal) => {
        await options.limiter?.acquire(signal);
        let response;
        try {
            response = await options.http({
                url: url.toString(),
                headers: { Referer: 'https://y.qq.com/' },
                signal,
            });
        }
        catch (error) {
            throw networkFailure(error, operation);
        }
        if (response.status >= 300 && response.status < 400)
            throw new QqApiError('upstream-http', { upstreamHttpStatus: response.status });
        if (response.status < 200 || response.status >= 300)
            throw normalizeQqFailure({
                source: 'http',
                upstreamHttpStatus: response.status,
                ...(response.retryAfterMs === undefined ? {} : { retryAfterMs: response.retryAfterMs }),
            }, { operation, readOnly: true });
        if (!response.bytes)
            throw new QqApiError('invalid-response');
        return checked(decode(response.bytes), operation);
    }, options.timeoutMs ?? 25000);
};
