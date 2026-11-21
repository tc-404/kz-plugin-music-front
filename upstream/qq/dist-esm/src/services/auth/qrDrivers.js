import { dictionaryOf, isAbortError } from '../../util/values.js';
import { createNativeQr } from './bootstrap.js';
import { createPtloginQr, exchangePtloginCredential, pollPtloginQr, } from './ptlogin.js';
import { logWechatQr } from './qrDiagnostics.js';
import { qrFailureDetailsOf } from './qrFailures.js';
import { createWechatQr, eventForWechatStatus, fetchWechatQrImage, pollWechatQr, WECHAT_STATUS, } from './wechatLogin.js';
// src/services/auth/qrDrivers.ts
// 从认证入口搬出的同一套实现；协议、状态与对外回包沿用原规则。
/**
 * `qq` is a push channel: the MQTT listener started here delivers events the instant they
 * arrive, which is what keeps this channel's timing identical to the pre-driver implementation.
 * `advance()` therefore has nothing left to observe.
 */
export const createQqQrDriver = (options) => {
    const listeners = new Map();
    return {
        mode: 'push',
        createQr: async () => {
            const qr = await createNativeQr(options.http, options.device());
            return { identifier: qr.qrcodeId, imageUrl: qr.imageUrl, expiresIn: qr.expiresIn };
        },
        start: (session, context) => {
            const listener = options.listen(session.identifier ?? '', context.onEvent, context.timeoutMs);
            listeners.set(session.key, listener);
            return listener;
        },
        advance: async () => [],
        close: (session) => {
            listeners.get(session.key)?.close();
            listeners.delete(session.key);
        },
    };
};
/**
 * `qq` as a *pull* channel, for serverless runtimes. Same upstream protocol as the push driver
 * above; the difference is only who holds the socket — a relay does, and each `advance()` drains
 * what it has collected.
 */
export const createRelayQqQrDriver = (options) => {
    const now = options.now ?? Date.now;
    return {
        mode: 'pull',
        createQr: async (session) => {
            // A session reconstructed from a sealed key already has its `qrcodeID`. Calling
            // `CreateQRCode` again would mint a *second, different* code upstream, orphaning both the
            // relay's subscription and the identifier sealed into the key the client is holding — the
            // same hazard `createWechatQrDriver` documents, with a worse failure mode: the code on
            // screen would simply never resolve. Only the image is re-fetched.
            if (session.identifier) {
                return {
                    identifier: session.identifier,
                    imageUrl: await options.relay.image(session.identifier),
                };
            }
            const qr = await createNativeQr(options.http, options.device());
            // Subscribed before the image is returned, never after: see `createMqttListenOver`.
            await options.relay.open(qr.qrcodeId, qr.imageUrl, Math.max(0, session.expiresAt - now()));
            return { identifier: qr.qrcodeId, imageUrl: qr.imageUrl, expiresIn: qr.expiresIn };
        },
        advance: async (session, budgetMs) => session.identifier ? options.relay.poll(session.identifier, budgetMs) : [],
        // `close` is synchronous by contract, so this is the best-effort path only. The route that has
        // to *guarantee* the socket is released — `/login/qr/cancel`, where the cost of a leak is a
        // relay billed for the rest of the QR's life — awaits `relay.close` itself.
        close: (session) => {
            if (session.identifier)
                void options.relay.close(session.identifier).catch(() => undefined);
        },
    };
};
/**
 * `wechat` is a pull channel: every `advance()` is one time-boxed long poll and nothing runs
 * between calls. A closed dialog therefore stops polling immediately instead of holding a loop
 * open for the rest of the QR's life, and a serverless invocation can serve the channel at all.
 */
export const createWechatQrDriver = (options) => ({
    mode: 'pull',
    createQr: async (session, signal) => {
        // A session reconstructed from a sealed `unikey` already carries the `uuid` a previous
        // invocation obtained — sealing the image itself would have meant sealing tens of KB of
        // base64 PNG into every `unikey`. Reusing it here, rather than calling `createWechatQr`
        // again, is what keeps this call from minting a second, different WeChat QR under the same
        // `unikey`; only the image is re-fetched.
        if (session.identifier) {
            return {
                identifier: session.identifier,
                imageUrl: await fetchWechatQrImage(options.http(session), session.identifier, { signal }),
            };
        }
        const qr = await createWechatQr(options.http(session), { signal });
        return { identifier: qr.identifier, imageUrl: qr.imageUrl };
    },
    advance: async (session, budgetMs, signal) => {
        if (!session.identifier)
            return [];
        const startedAt = Date.now();
        try {
            // A serverless check rebuilds the session as `waiting`, so only a runtime that kept the
            // scan sends the cursor; without it the request is exactly what it was before.
            const status = await pollWechatQr(options.http(session), session.identifier, {
                budgetMs,
                signal,
                last: session.state === 'scanned' ? WECHAT_STATUS.scanned : undefined,
            });
            const event = eventForWechatStatus(status);
            logWechatQr(session, 'poll', {
                outcome: 'status',
                upstreamCode: status.upstreamCode,
                durationMs: Math.max(0, Date.now() - startedAt),
                budgetMs,
            });
            return [event];
        }
        catch (error) {
            // The budget elapsing is the normal outcome of a long poll that saw no state change, so it
            // reports "nothing happened" rather than an upstream failure. A caller-driven abort is a
            // real cancellation and stays an error.
            if (isAbortError(error) && signal?.aborted !== true) {
                logWechatQr(session, 'poll', {
                    outcome: 'budget-expired',
                    durationMs: Math.max(0, Date.now() - startedAt),
                    budgetMs,
                });
                return [];
            }
            const failure = qrFailureDetailsOf(error, 'qr-poll', 'wechat');
            logWechatQr(session, 'poll', {
                outcome: 'error',
                durationMs: Math.max(0, Date.now() - startedAt),
                budgetMs,
                failureReason: failure.failureReason,
                upstreamCode: failure.upstreamCode,
                upstreamHttpStatus: failure.upstreamHttpStatus,
            });
            throw error;
        }
    },
    close: () => undefined,
});
/**
 * `qq` 在没有 relay 的 Serverless 上改走纯 HTTP 扫码（QQ 互联网页登录，见 `ptlogin.ts`）。
 * 每次 `advance()` 只查一次 ptqrlogin；确认之后由服务调 `exchange()` 一路换到凭证，
 * 时限是这次 check 剩下的时间。中间拿到的 QQ 全局 Cookie 不出 `exchangePtloginCredential`。
 */
export const createPtloginQrDriver = (options = {}) => ({
    mode: 'pull',
    createQr: async (session, signal) => {
        // 封存的 unikey 自己带着图片（见 qrRuntime 的 replayedRecord），服务不会为同一张码再来要图；
        // 再调一次 ptqrshow 会换掉 qrsig，手机上那张码就永远登不进来了。
        if (session.identifier)
            throw new Error('Ptlogin QR cannot be redrawn');
        const qr = await createPtloginQr({ fetch: options.fetch, signal });
        return { identifier: qr.qrsig, imageUrl: qr.imageUrl, expiresIn: qr.expiresIn };
    },
    advance: async (session, budgetMs, signal) => {
        if (!session.identifier)
            return [];
        const poll = await pollPtloginQr(session.identifier, {
            fetch: options.fetch,
            signal: signal ?? AbortSignal.timeout(Math.max(1, Math.min(budgetMs, 10_000))),
        });
        if (poll.status === 'waiting')
            return [{ type: 'waiting', payload: null }];
        if (poll.status === 'scanned')
            return [{ type: 'scanned', payload: null }];
        if (poll.status === 'expired')
            return [{ type: 'timeout', payload: null }];
        return [{ type: 'authorized', payload: { checkSigUrl: poll.checkSigUrl } }];
    },
    exchange: async (_session, payload, signal) => {
        const checkSigUrl = dictionaryOf(payload).checkSigUrl;
        if (typeof checkSigUrl !== 'string')
            throw new Error('Ptlogin check_sig URL is missing');
        return exchangePtloginCredential(checkSigUrl, { fetch: options.fetch, signal });
    },
    close: () => undefined,
});
