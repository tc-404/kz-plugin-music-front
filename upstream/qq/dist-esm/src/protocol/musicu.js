import { normalizeQqFailure, QqApiError } from './errors.js';
import { checkAbort, HttpTransportError, sleep, withDeadline } from './http.js';
import { defaultTokenBucket } from './tokenBucket.js';
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value) => typeof value === 'number' && Number.isSafeInteger(value);
const snapshot = (value) => {
    try {
        return JSON.parse(JSON.stringify(value, (_key, entry) => {
            if (entry === undefined ||
                ['function', 'symbol', 'bigint'].includes(typeof entry) ||
                (typeof entry === 'number' && !Number.isFinite(entry)))
                throw new Error();
            return entry;
        }));
    }
    catch {
        throw new QqApiError('input');
    }
};
const prepare = (input) => {
    if (!input ||
        typeof input.module !== 'string' ||
        !input.module.trim() ||
        typeof input.method !== 'string' ||
        !input.method.trim() ||
        !object(input.param) ||
        typeof input.readOnly !== 'boolean' ||
        (input.decode !== undefined && typeof input.decode !== 'function') ||
        (input.allowedCodes !== undefined &&
            (!Array.isArray(input.allowedCodes) || !input.allowedCodes.every(integer))))
        throw new QqApiError('input');
    return { ...input, param: snapshot(input.param), allowedCodes: [...(input.allowedCodes ?? [])] };
};
const unpack = (body, requests) => {
    if (!object(body) || !integer(body.code))
        throw new QqApiError('invalid-response');
    if (body.code !== 0)
        throw normalizeQqFailure({ source: 'gateway', upstreamGlobalCode: body.code });
    return requests.map((request, index) => {
        const item = body[`req_${index}`];
        if (!object(item) ||
            !integer(item.code) ||
            (item.subcode !== undefined && !integer(item.subcode)))
            return { ok: false, error: new QqApiError('invalid-response') };
        if (item.code !== 0 && !request.allowedCodes?.includes(item.code))
            return {
                ok: false,
                error: normalizeQqFailure({
                    source: 'business',
                    upstreamCode: item.code,
                    upstreamGlobalCode: body.code,
                    upstreamSubCode: item.subcode,
                }, { operation: request.operation }),
            };
        if (!Object.hasOwn(item, 'data') || (item.subcode !== undefined && item.subcode !== 0))
            return {
                ok: false,
                error: new QqApiError('invalid-response', { upstreamSubCode: item.subcode }),
            };
        try {
            return {
                ok: true,
                code: item.code,
                data: request.decode ? request.decode(item.data) : item.data,
            };
        }
        catch {
            return { ok: false, error: new QqApiError('invalid-response') };
        }
    });
};
/** Explicit batches share only this client's immutable comm/header context. Old routes do not use it. */
export const createMusicuClient = (options) => {
    if (!object(options.comm))
        throw new QqApiError('input');
    const comm = snapshot(options.comm);
    const headers = snapshot(options.headers ?? {});
    const http = options.http;
    const limiter = options.limiter ?? defaultTokenBucket;
    const timeoutMs = options.timeoutMs ?? 25000;
    const maxRetries = options.maxRetries ?? 2;
    const random = options.random ?? Math.random;
    if (!Number.isSafeInteger(timeoutMs) ||
        timeoutMs <= 0 ||
        timeoutMs > 2_147_483_647 ||
        !Number.isSafeInteger(maxRetries) ||
        maxRetries < 0 ||
        maxRetries > 2)
        throw new QqApiError('input');
    const executeBatch = async (inputs, execution = {}) => {
        const requests = inputs.map(prepare);
        if (!requests.length)
            return [];
        const payload = { comm };
        requests.forEach((r, index) => {
            payload[`req_${index}`] = { module: r.module, method: r.method, param: r.param };
        });
        const body = JSON.stringify(payload);
        const readOnly = requests.every((r) => r.readOnly);
        return withDeadline(async (signal) => {
            for (let attempt = 0;; attempt += 1) {
                await limiter.acquire(signal);
                checkAbort(signal);
                let error;
                try {
                    const response = await http({
                        url: 'https://u.y.qq.com/cgi-bin/musicu.fcg',
                        body,
                        headers: { ...headers },
                        signal,
                    });
                    checkAbort(signal);
                    if (!integer(response.status) || response.status < 200 || response.status > 599)
                        throw new QqApiError('invalid-response');
                    if (response.status >= 400) {
                        error = normalizeQqFailure({
                            source: 'http',
                            upstreamHttpStatus: response.status,
                            retryAfterMs: response.retryAfterMs,
                        }, { readOnly });
                    }
                    else if (response.status >= 300) {
                        throw new QqApiError('invalid-response');
                    }
                    else
                        return unpack(response.body, requests);
                }
                catch (failure) {
                    checkAbort(signal);
                    error =
                        failure instanceof QqApiError
                            ? failure
                            : normalizeQqFailure({
                                source: 'network',
                                error: failure instanceof HttpTransportError ? { code: failure.code } : undefined,
                            }, {
                                readOnly,
                                networkPhase: failure instanceof HttpTransportError ? failure.phase : 'unknown',
                            });
                }
                if (!readOnly || !error.retryable || attempt >= maxRetries)
                    throw error;
                const base = 200 * 2 ** attempt;
                const jitter = random();
                await sleep(base +
                    Math.floor(base * (Number.isFinite(jitter) ? Math.max(0, Math.min(1, jitter)) : 0)), signal);
            }
        }, timeoutMs, execution.signal);
    };
    return {
        executeBatch,
        async execute(request, execution = {}) {
            const [result] = await executeBatch([request], execution);
            if (!result.ok)
                throw result.error;
            return result.data;
        },
    };
};
