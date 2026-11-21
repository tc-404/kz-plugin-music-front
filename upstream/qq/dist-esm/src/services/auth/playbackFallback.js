import { QqApiError } from '../../protocol/errors.js';
import { playbackFileTypeOf } from '../../protocol/playbackFiles.js';
import { webSessionVKeyStrategy } from './playbackStrategies.js';
/** 候选这次要用的做法。 */
export const candidateStrategyOf = (candidate, quality) => typeof candidate.strategy === 'function' ? candidate.strategy(quality) : candidate.strategy;
/** 官方网页播放器身份试这几种音质；ape 没文件时上游也会给假链接，试听另有路，都不试。 */
const WEB_SESSION_QUALITIES = new Set(['m4a', '128', '320', 'flac']);
/** 安卓身份明确回 104003（没给完整文件）时，换官方网页播放器身份再要一次。 */
export const WEB_SESSION_CANDIDATE = {
    id: 'web-session-vkey',
    appliesTo: ({ quality, codes }) => WEB_SESSION_QUALITIES.has(quality) && codes.result === 104003,
    strategy: (quality) => webSessionVKeyStrategy(playbackFileTypeOf(quality)),
};
/** 登记的候选，按顺序试：见文件开头。 */
export const PLAYBACK_FALLBACK_CANDIDATES = [
    WEB_SESSION_CANDIDATE,
];
/** 宿主读环境变量用的开关：没设或其他值都开着，只有 0 和 false 关掉。 */
export const playbackFallbackEnabledOf = (value) => !['0', 'false'].includes(value ?? '');
export const DEFAULT_PLAYBACK_FALLBACK_LIMITS = {
    maxRequests: 16,
    timeoutMs: 10_000,
};
export const PLAYBACK_FALLBACK_DISABLED = { enabled: false };
/** 一次取链接（quality=best 的几级共用同一个）的请求和时间预算。 */
export class PlaybackRequestBudget {
    limits;
    now;
    requests = 0;
    startedAt;
    constructor(limits, now) {
        this.limits = limits;
        this.now = now;
        this.startedAt = now();
    }
    count() {
        this.requests += 1;
    }
    get used() {
        return this.requests;
    }
    hasRequests() {
        return this.requests < this.limits.maxRequests;
    }
    remainingMs() {
        return this.limits.timeoutMs - (this.now() - this.startedAt);
    }
    elapsedSince(start) {
        return Math.max(0, this.now() - start);
    }
    clock() {
        return this.now();
    }
}
export const playbackBudgetOf = (options) => new PlaybackRequestBudget(options.limits ?? DEFAULT_PLAYBACK_FALLBACK_LIMITS, options.now ?? Date.now);
/** 主路径用的客户端：每打一次上游就记一笔，其余照旧。只在开关开着时包。 */
export const countingHttpOf = (http, budget) => ({
    getCookieHeader: () => http.getCookieHeader(),
    request: (config) => {
        budget.count();
        return http.request(config);
    },
    post: (url, data, config) => {
        budget.count();
        return http.post(url, data, config);
    },
});
/** 显式加密取链接共用这些限额，超时会终止正在发送的请求。 */
export const withBoundedPlaybackHttp = async (http, operation, limits = DEFAULT_PLAYBACK_FALLBACK_LIMITS, externalSignal) => {
    const budget = new PlaybackRequestBudget(limits, Date.now);
    const abort = new AbortController();
    const timeoutError = () => new QqApiError('network', { errorKey: 'network.timeout' });
    const reserve = () => {
        if (abort.signal.aborted || budget.remainingMs() <= 0)
            throw timeoutError();
        if (!budget.hasRequests())
            throw new QqApiError('rate-limited');
        budget.count();
    };
    const beforeRequest = () => {
        reserve();
        return { signal: abort.signal, followRedirects: false };
    };
    const bounded = {
        getCookieHeader: () => http.getCookieHeader(),
        request: (config) => http.request({ ...config, ...beforeRequest() }),
        post: (url, data, config) => http.post(url, data, { ...config, ...beforeRequest() }),
    };
    let timedOut = false;
    const cancel = () => abort.abort();
    const interrupted = new Promise((_resolve, reject) => {
        abort.signal.addEventListener('abort', () => reject(timedOut ? timeoutError() : new QqApiError('network', { errorKey: 'network.aborted' })), { once: true });
    });
    if (externalSignal?.aborted)
        cancel();
    else
        externalSignal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => {
        timedOut = true;
        abort.abort();
    }, limits.timeoutMs);
    try {
        const result = await Promise.race([
            interrupted,
            abort.signal.aborted ? interrupted : operation(bounded),
        ]);
        return result;
    }
    catch (error) {
        if (abort.signal.aborted)
            throw timedOut ? timeoutError() : new QqApiError('network', { errorKey: 'network.aborted' });
        throw error;
    }
    finally {
        clearTimeout(timer);
        externalSignal?.removeEventListener('abort', cancel);
    }
};
const TIMED_OUT = Symbol('timed-out');
/** 最多等 `ms` 毫秒；等不到回 TIMED_OUT。上游那边的请求没法取消，结果到了也不用。 */
export const withinPlaybackDeadline = async (work, ms) => {
    let timer;
    try {
        return await Promise.race([
            work,
            new Promise((resolve) => {
                timer = setTimeout(() => resolve(TIMED_OUT), Math.max(0, ms));
            }),
        ]);
    }
    finally {
        if (timer !== undefined)
            clearTimeout(timer);
    }
};
export const isPlaybackDeadlineMiss = (value) => value === TIMED_OUT;
