import { CgiNetworkError } from '../protocol/cgi.js';
import { QqApiError } from '../protocol/errors.js';
const stringOf = (value) => typeof value === 'string' ? value : undefined;
const property = (value, key) => {
    try {
        return value && typeof value === 'object' ? value[key] : undefined;
    }
    catch {
        return undefined;
    }
};
const observed = (error) => new CgiNetworkError({
    name: stringOf(property(error, 'name')),
    code: stringOf(property(error, 'code') ?? property(property(error, 'cause'), 'code')),
});
const retryDelay = (value) => value && /^\d+(?:\.\d+)?$/.test(value) ? Math.ceil(Number(value) * 1000) : undefined;
/** 默认每次调用时才取全局 fetch，测试或嵌入方替换全局 fetch 也能生效。 */
export const createFetchCgiTransport = (fetcher = (url, init) => globalThis.fetch(url, init)) => async (request) => {
    let response;
    try {
        response = await fetcher(request.url, {
            method: 'GET',
            redirect: 'manual',
            headers: request.headers,
            signal: request.signal,
        });
    }
    catch (error) {
        throw observed(error);
    }
    if (response.status < 200 || response.status >= 300) {
        void response.body?.cancel().catch(() => { });
        return {
            status: response.status,
            retryAfterMs: retryDelay(response.headers.get('Retry-After')),
        };
    }
    try {
        if (request.maxBytes !== undefined) {
            const length = response.headers.get('Content-Length');
            if (length && /^\d+$/.test(length) && Number(length) > request.maxBytes) {
                void response.body?.cancel().catch(() => { });
                throw new QqApiError('invalid-response');
            }
            if (!response.body)
                return { status: response.status, bytes: new ArrayBuffer(0) };
            const reader = response.body.getReader();
            const chunks = [];
            let size = 0;
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                size += value.byteLength;
                if (size > request.maxBytes) {
                    void reader.cancel().catch(() => { });
                    throw new QqApiError('invalid-response');
                }
                chunks.push(value);
            }
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) {
                bytes.set(chunk, offset);
                offset += chunk.byteLength;
            }
            return { status: response.status, bytes: bytes.buffer };
        }
        return { status: response.status, bytes: await response.arrayBuffer() };
    }
    catch (error) {
        if (error instanceof QqApiError)
            throw error;
        throw observed(error);
    }
};
