// Selects a stream base from QQ's dispatch response without exposing signed song URLs in logs.
const PROBE_BYTES = 256 * 1024;
const PROBE_TIMEOUT_MS = 5_000;
const DEFAULT_CACHE_MS = 30 * 60 * 1_000;
const MIN_CACHE_MS = 60 * 1_000;
const MAX_CACHE_MS = 24 * 60 * 60 * 1_000;
const byteLengthOf = (value) => {
    if (value instanceof ArrayBuffer)
        return value.byteLength;
    if (ArrayBuffer.isView(value))
        return value.byteLength;
    return 0;
};
export const createStreamUrlProbe = (http) => async (url) => {
    const startedAt = Date.now();
    try {
        const response = await http.request({
            url,
            method: 'GET',
            headers: {
                Accept: '*/*',
                'Accept-Encoding': 'identity',
                Range: `bytes=0-${PROBE_BYTES - 1}`,
            },
            responseType: 'arraybuffer',
            maxContentLength: PROBE_BYTES,
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        if (response.status !== 206)
            return null;
        const bytes = byteLengthOf(response.data);
        return bytes > 0 ? { bytes, elapsedMs: Math.max(1, Date.now() - startedAt) } : null;
    }
    catch {
        return null;
    }
};
const normalizeBase = (value) => {
    try {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:')
            return null;
        const host = url.hostname.toLowerCase();
        if (!host.endsWith('.qqmusic.qq.com') && !host.endsWith('.tc.qq.com'))
            return null;
        url.pathname = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
        url.search = '';
        url.hash = '';
        return url.toString();
    }
    catch {
        return null;
    }
};
export class StreamCdnSelector {
    probe;
    now;
    cached = null;
    // 正在进行的探测按候选地址分开记：候选不一样的请求不能拿别人的结果。
    selecting = new Map();
    constructor(probe, now = Date.now) {
        this.probe = probe;
        this.now = now;
    }
    async select(candidates, purl, refreshAfterMs = DEFAULT_CACHE_MS) {
        const bases = [...new Set(candidates.map(normalizeBase).filter((value) => value !== null))];
        if (bases.length === 0 || !purl)
            return null;
        if (this.cached && this.cached.expiresAt > this.now() && bases.includes(this.cached.base))
            return this.cached.base;
        const key = bases.join('|');
        const pending = this.selecting.get(key);
        if (pending)
            return pending;
        const started = this.measure(bases, purl, refreshAfterMs).finally(() => {
            this.selecting.delete(key);
        });
        this.selecting.set(key, started);
        return started;
    }
    // Measures candidates concurrently so a throttled fallback cannot serially delay playback.
    async measure(bases, purl, refreshAfterMs) {
        const results = await Promise.all(bases.map(async (base) => ({
            base,
            result: await this.probe(new URL(purl, base).toString()),
        })));
        const fastest = results
            .filter((entry) => entry.result !== null)
            .sort((left, right) => right.result.bytes / right.result.elapsedMs - left.result.bytes / left.result.elapsedMs)[0];
        if (!fastest)
            return null;
        const cacheMs = Math.min(MAX_CACHE_MS, Math.max(MIN_CACHE_MS, refreshAfterMs));
        this.cached = { base: fastest.base, expiresAt: this.now() + cacheMs };
        return fastest.base;
    }
}
