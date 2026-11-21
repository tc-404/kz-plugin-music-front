import { QqApiError } from './errors.js';
/** An adapter observation, containing no native exception, URL, body or credential. */
export class HttpTransportError extends Error {
    code;
    phase;
    constructor(observation) {
        super('HTTP transport failed');
        this.name = 'HttpTransportError';
        this.code = observation.code;
        this.phase = observation.phase;
    }
}
export const checkAbort = (signal) => {
    if (signal.aborted)
        throw new QqApiError('network', { errorKey: 'network.aborted' });
};
export const sleep = (ms, signal) => new Promise((resolve, reject) => {
    checkAbort(signal);
    const finish = () => {
        signal.removeEventListener('abort', abort);
        resolve();
    };
    const timer = setTimeout(finish, Math.min(ms, 2_147_483_647));
    const abort = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        reject(new QqApiError('network', { errorKey: 'network.aborted' }));
    };
    signal.addEventListener('abort', abort, { once: true });
});
/** One budget covers queueing, every attempt, reading the body and backoff. */
export const withDeadline = async (run, timeoutMs, external) => {
    if (external?.aborted)
        throw new QqApiError('network', { errorKey: 'network.aborted' });
    const controller = new AbortController();
    let timer;
    let abort = () => { };
    const interrupted = new Promise((_resolve, reject) => {
        abort = () => {
            reject(new QqApiError('network', { errorKey: 'network.aborted' }));
            controller.abort();
        };
        external?.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => {
            reject(new QqApiError('network', { errorKey: 'network.timeout' }));
            controller.abort();
        }, timeoutMs);
    });
    try {
        return await Promise.race([interrupted, run(controller.signal)]);
    }
    finally {
        clearTimeout(timer);
        external?.removeEventListener('abort', abort);
        controller.abort();
    }
};
