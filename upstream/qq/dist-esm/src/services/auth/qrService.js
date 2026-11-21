import { QqApiError } from '../../protocol/errors.js';
import { AuthCredentialRejectedError } from '../../util/authError.js';
import { logger } from '../../util/logger.js';
import { RequestRejectedError } from '../../util/requestError.js';
import { dictionaryOf, identifierOf, stringOf } from '../../util/values.js';
import { authSessionExpiryAt, getAuthenticatedSongListDetail, getFavoriteAlbums, getLikedSongs, getLoginProfile, getLoginUser, getOwnedPlaylistSongs, getPlaylists, isOwnAccountId, positiveIdOf, refreshLoginCredential, validateWechatCredential, withCredentialRejectionMapped, } from './authenticatedReads.js';
import { ensureQimei, refreshAndroidSession } from './bootstrap.js';
import { exchangeAppCredential, exchangeCredential, exchangeWechatCredential, MOBILE_LOGIN_TYPE, } from './credentialWire.js';
import { createDeviceContextStore, createMemoryDeviceContextRepository, } from './deviceContextStore.js';
import { getEncryptedPlayUrls } from './encryptedPlayback.js';
import { QqDeviceBootstrapError, QqProtocolError, QrLoginServiceError } from './musicuProtocol.js';
import { getAuthenticatedPlayUrls } from './playback.js';
import { withBoundedPlaybackHttp } from './playbackFallback.js';
import { logQqCookies, logWechatQr } from './qrDiagnostics.js';
import { createQqQrDriver, createWechatQrDriver } from './qrDrivers.js';
import { confirmingState, failureDetailsOf, primaryFailureOf, qrFailureDetailsOf, terminalState, } from './qrFailures.js';
import { DEFAULT_LOGIN_CHANNEL, isMqttLoginChannel, NODE_RUNTIME_CAPABILITIES, normalizeLoginChannel, } from './qrTypes.js';
import { createMemoryAuthSessionRepository, createMemoryQrSessionRepository, createQrSessionStore, createStoredSessionResolver, randomBytesNeutral, unavailableHttpClient, unavailableListen, } from './sessionState.js';
import { createStreamUrlProbe, StreamCdnSelector } from './streamCdnSelector.js';
import { MAX_CONSECUTIVE_POLL_ERRORS, WECHAT_DEFAULT_POLL_BUDGET_MS, WECHAT_LOGIN_TYPE, WechatQrError, } from './wechatLogin.js';
// src/services/auth/qrService.ts
// 从认证入口搬出的同一套实现；协议、状态与对外回包沿用原规则。
export const QR_TTL_MS = 3 * 60 * 1000;
export const ENCRYPTED_PLAYBACK_LIMITS = { maxRequests: 16, timeoutMs: 15_000 };
/** Every failure cools the next QR down by the same amount; repeated failures never double it. */
export const QR_COOLDOWN_MS = 15 * 1000;
/** The upstream explicitly said "too frequent" (login 104604 or an upstream HTTP 429). */
export const QR_RATE_LIMITED_COOLDOWN_MS = 30 * 1000;
/**
 * 确认后的领取期：手机上最后几秒才确认时，二维码已经过了有效期，还在路上的轮询仍要拿得到 803。
 * 领取期是二维码有效期和确认后这么久里较晚的那个。
 */
export const QR_CLAIM_MS = 60 * 1000;
const LOGIN_RATE_LIMITED_CODE = 104604;
// A fallback's own result replaces the primary one on top, so "too frequent" is looked for in both.
const isRateLimitedFailure = (details) => details.upstreamCode === LOGIN_RATE_LIMITED_CODE ||
    details.upstreamHttpStatus === 429 ||
    details.primaryFailure?.upstreamCode === LOGIN_RATE_LIMITED_CODE;
export class QrLoginServiceImpl {
    http;
    playbackHintsEnabled;
    playbackFallbackEnabled;
    streamCdnSelector;
    createSessionHttp;
    now;
    random;
    capabilities;
    checkBudgetMs;
    drivers;
    qrSessionStore;
    qrRuntimes = new Map();
    /** 换凭证时被客户端取消的扫码：换完不发会话，记一条没交出去。 */
    withdrawals = new WeakSet();
    /**
     * 已确认的扫码什么时候确认、803 有没有交出去过。不放进 QrSessionRecord，保存格式不变；
     * 重启后还原的已确认扫码没有这条记录，当成交出去过，免得误撤一个可能已经在用的会话。
     */
    claims = new Map();
    sessionResolver;
    deviceStore;
    creatingSession = false;
    nextQrAllowedAt = 0;
    lastQrFailure;
    constructor(dependencies) {
        this.http = dependencies.http ?? unavailableHttpClient();
        this.playbackHintsEnabled = dependencies.playbackHintsEnabled !== false;
        this.playbackFallbackEnabled = dependencies.playbackFallbackEnabled === true;
        this.streamCdnSelector = new StreamCdnSelector(dependencies.streamUrlProbe ?? createStreamUrlProbe(this.http), dependencies.now ?? Date.now);
        this.createSessionHttp = dependencies.createSessionHttp ?? unavailableHttpClient;
        this.now = dependencies.now ?? Date.now;
        this.random = dependencies.randomBytes ?? randomBytesNeutral;
        this.capabilities = dependencies.capabilities ?? NODE_RUNTIME_CAPABILITIES;
        this.checkBudgetMs = dependencies.checkBudgetMs ?? WECHAT_DEFAULT_POLL_BUDGET_MS;
        this.deviceStore = createDeviceContextStore(dependencies.deviceRepository ?? createMemoryDeviceContextRepository());
        this.sessionResolver =
            dependencies.sessionResolver ??
                createStoredSessionResolver({
                    repository: dependencies.authSessionRepository ?? createMemoryAuthSessionRepository(),
                    now: this.now,
                    randomBytes: this.random,
                    refreshCredential: (session) => refreshLoginCredential(this.http, session.device, session.credential),
                });
        this.qrSessionStore = createQrSessionStore(dependencies.qrSessionRepository ?? createMemoryQrSessionRepository());
        const mqttDriver = () => createQqQrDriver({
            http: this.http,
            device: () => this.deviceStore.get(),
            listen: dependencies.listen ?? unavailableListen,
        });
        this.drivers = {
            qq: mqttDriver(),
            // 同一套二维码与 MQTT；差别只在换凭证时照回调给的账号类型（见 exchangeQqLogin）。
            qqmusic: mqttDriver(),
            wechat: createWechatQrDriver({ http: (session) => this.sessionHttp(session) }),
            ...dependencies.drivers,
        };
    }
    getCapabilities() {
        return this.capabilities;
    }
    runtimeFor(session) {
        const existing = this.qrRuntimes.get(session.key);
        if (existing)
            return existing;
        const driver = this.drivers[session.channel];
        if (!driver)
            throw new QrLoginServiceError(`Unsupported QR login channel: ${session.channel}`, 400);
        const runtime = { driver, pollErrors: 0 };
        this.qrRuntimes.set(session.key, runtime);
        return runtime;
    }
    dropSession(session) {
        // Closing MQTT rejects the listener's pending read. Retire the session first so its late
        // events and rejection cannot turn intentional teardown into another login failure.
        if (!terminalState(session.state))
            session.state = 'expired';
        const runtime = this.qrRuntimes.get(session.key);
        runtime?.listener?.close();
        runtime?.driver.close(session);
        this.qrRuntimes.delete(session.key);
        this.claims.delete(session.key);
        this.qrSessionStore.delete(session.key);
    }
    /** 换到的凭证没交到客户端手上：撤销会话，记下在哪一步丢的。不记任何凭证或账号。 */
    discardUndelivered(session, token, reason) {
        if (token)
            void this.sessionResolver.revoke(token).catch((error) => {
                logger.warn('qq-auth.login-undelivered-revoke-failed', {
                    loginChannel: session.channel,
                    name: error instanceof Error ? error.name : 'Error',
                });
            });
        logger.warn('qq-auth.login-undelivered', { loginChannel: session.channel, reason });
    }
    cleanup() {
        const current = this.now();
        for (const session of this.qrSessionStore.values()) {
            if (session.expiresAt > current)
                continue;
            // 换凭证中的扫码手机上已经确认了，几秒内就会变成已确认或失败，到时再按领取期处理。
            if (session.state === 'exchanging')
                continue;
            if (session.state === 'confirmed') {
                const claim = this.claims.get(session.key);
                if (claim && current < claim.confirmedAt + QR_CLAIM_MS)
                    continue;
                if (claim && !claim.delivered)
                    this.discardUndelivered(session, session.authToken, 'unclaimed');
                this.dropSession(session);
                continue;
            }
            // A pull channel has no background timer to raise `timeout` at expiry, so the expiry itself
            // has to keep counting as a failure. Both guards mirror when a push listener would have
            // raised it: only after a code exists to scan, and only if nothing terminal happened first.
            // A key that was issued and abandoned before `createQr` never backed anything off.
            if (!terminalState(session.state) && session.imageUrl !== undefined)
                this.backoff();
            this.dropSession(session);
        }
        this.sessionResolver.cleanup?.();
    }
    backoff(details = { failureStage: 'qr-event', failureReason: 'qr-timeout' }) {
        this.lastQrFailure = failureDetailsOf(details);
        const delay = isRateLimitedFailure(this.lastQrFailure)
            ? QR_RATE_LIMITED_COOLDOWN_MS
            : QR_COOLDOWN_MS;
        this.nextQrAllowedAt = this.now() + delay;
        return delay;
    }
    confirmingQrExists() {
        return this.qrSessionStore.values().some((session) => confirmingState(session.state));
    }
    /**
     * Closes and drops the codes nobody is scanning. Without this a dialog that was opened and shut
     * without a scan would hold the slot for the whole QR TTL, so the next login attempt — including
     * the one after a hard app restart, where no cancel could ever be sent — got a 409 it could not
     * clear by retrying.
     */
    discardPreemptibleSessions() {
        for (const session of this.qrSessionStore.values()) {
            if (terminalState(session.state) || confirmingState(session.state))
                continue;
            this.dropSession(session);
            logger.info('qq-auth.qr-session-preempted', { loginChannel: session.channel });
        }
    }
    sessionFor(key) {
        this.cleanup();
        const session = this.qrSessionStore.get(key);
        if (!session)
            throw new QrLoginServiceError('QR session not found or expired', 404);
        return session;
    }
    async authFor(token) {
        this.cleanup();
        return this.sessionResolver.resolve(token);
    }
    /**
     * Turns a pre-session bootstrap failure into a backed-off client error, so repeated clicks
     * get one 502 with Retry-After and then 429s instead of a stream of upstream calls.
     */
    failBootstrap(error, stage) {
        if (error instanceof QrLoginServiceError)
            return error;
        const bootstrap = error instanceof QqDeviceBootstrapError ? error : null;
        const protocol = error instanceof QqProtocolError ? error : null;
        const diagnostics = qrFailureDetailsOf(error, stage);
        const retryAfterMs = this.backoff(diagnostics);
        const upstreamCode = bootstrap?.outerCode ?? protocol?.upstreamCode;
        logger.warn('qq-auth.bootstrap-failed', {
            phase: bootstrap ? 'qimei' : (protocol?.phase ?? 'unknown'),
            outerCode: bootstrap?.outerCode,
            innerCode: bootstrap?.innerCode,
            upstreamCode: protocol?.upstreamCode,
            retryAfterMs,
            name: error instanceof Error ? error.name : 'Error',
            ...diagnostics,
        });
        return new QrLoginServiceError('Unable to start QR login', 502, retryAfterMs, upstreamCode, diagnostics);
    }
    failSession(session, error, stage) {
        if (terminalState(session.state))
            return;
        session.state = 'failed';
        Object.assign(session, qrFailureDetailsOf(error, stage, session.channel));
        session.retryAfterMs = this.backoff(session);
        this.qrSessionStore.persist();
        logger.warn('qq-auth.session-failed', {
            loginChannel: session.channel,
            retryAfterMs: session.retryAfterMs,
            ...failureDetailsOf(session),
            name: error instanceof Error ? error.name : 'Error',
        });
    }
    /**
     * MQTT channels: the payload carries an exchange token, never the final credential. `qqmusic`
     * exchanges with the account type the app reports (an app signed in with WeChat says 1 and is
     * only accepted with 1); `qq` keeps sending mobile QQ's 6, so a WeChat-bound app scan there
     * still fails into the existing wrong-app hint instead of logging in on the wrong channel.
     */
    async exchangeQqLogin(session, payload) {
        session.failureStage = 'credential-payload';
        logQqCookies(payload, session.channel === 'qqmusic' ? 'qqmusic' : 'qq');
        const cookies = dictionaryOf(dictionaryOf(payload).cookies);
        const musicid = stringOf(dictionaryOf(cookies.qqmusic_uin).value);
        const mqttToken = stringOf(dictionaryOf(cookies.qqmusic_key).value);
        if (!musicid || !mqttToken || !session.qrcodeId)
            throw new Error('MQTT cookies missing login credential');
        const loginType = session.channel === 'qqmusic' &&
            identifierOf(dictionaryOf(cookies.tmeLoginType).value) === String(WECHAT_LOGIN_TYPE)
            ? WECHAT_LOGIN_TYPE
            : MOBILE_LOGIN_TYPE;
        session.state = 'exchanging';
        const device = this.deviceStore.get();
        session.failureStage = 'credential-exchange';
        try {
            // 两个通道都送 6；QQ 音乐 App 通道照官方客户端送不失真的 id，账号类型以回包为准。
            return session.channel === 'qqmusic'
                ? await exchangeAppCredential(this.http, device, session.qrcodeId, musicid, mqttToken, loginType)
                : await exchangeCredential(this.http, device, session.qrcodeId, musicid, mqttToken);
        }
        catch (error) {
            // The fallback below replaces this failure on top whatever it returns, so it is kept here.
            session.primaryFailure = primaryFailureOf(error, 'credential-exchange', session.channel);
            session.fallbackAttempted = true;
            session.failureStage = 'credential-validation';
            const direct = {
                musicid,
                str_musicid: musicid,
                musickey: mqttToken,
                loginType,
            };
            await getLoginUser(this.http, {
                token: '',
                credential: direct,
                device,
                expiresAt: 0,
            });
            logger.warn('qq-auth.exchange-fallback', {
                upstreamCode: error instanceof QqProtocolError ? error.upstreamCode : undefined,
            });
            return direct;
        }
    }
    /** WeChat channel: the web flow yields an OAuth code, and there is no MQTT fallback. */
    async exchangeWechatLogin(session, payload) {
        session.failureStage = 'credential-payload';
        const code = stringOf(dictionaryOf(payload).code);
        if (!code)
            throw new WechatQrError('WeChat authorization missing code');
        session.state = 'exchanging';
        session.failureStage = 'credential-exchange';
        return exchangeWechatCredential(this.http, this.deviceStore.get(), code);
    }
    /**
     * 通道自己会换凭证时（手机 QQ 的纯 HTTP 扫码）走这里。时限是这次 check 剩下的时间：
     * 调用方等一个登录请求有上限，换不完就当这次失败，让用户重新扫。
     */
    async exchangeWithDriver(session, exchange, payload) {
        session.state = 'exchanging';
        session.failureStage = 'credential-exchange';
        const deadlineAt = this.qrRuntimes.get(session.key)?.deadlineAt;
        const remainingMs = (deadlineAt ?? this.now() + this.checkBudgetMs) - this.now();
        const signal = AbortSignal.timeout(Math.max(1, remainingMs));
        try {
            return await exchange(session, payload, signal);
        }
        catch (error) {
            // 到点中止时各平台给的错误不一样（DOMException、AbortError…），统一成同一种超时，
            // 失败原因才会稳定地是 network-timeout。
            if (signal.aborted)
                throw Object.assign(new Error('Credential exchange ran out of time'), {
                    name: 'TimeoutError',
                });
            throw error;
        }
    }
    async finalizeLogin(session, payload) {
        const exchange = this.qrRuntimes.get(session.key)?.driver.exchange;
        let credential = exchange
            ? await this.exchangeWithDriver(session, exchange, payload)
            : session.channel === 'wechat'
                ? await this.exchangeWechatLogin(session, payload)
                : await this.exchangeQqLogin(session, payload);
        if (session.channel === 'wechat') {
            session.failureStage = 'credential-validation';
            credential = await validateWechatCredential(this.http, this.deviceStore.get(), credential);
        }
        // 换凭证时客户端已经取消：没人会来拿，不发会话。
        if (this.withdrawals.has(session)) {
            this.discardUndelivered(session, undefined, 'canceled');
            return;
        }
        session.failureStage = 'session-issue';
        const token = await this.sessionResolver.issue({
            credential,
            device: this.deviceStore.get(),
            expiresAt: authSessionExpiryAt(credential, this.now()),
        });
        // 发会话的同时被取消：刚发的这把立刻撤掉。
        if (this.withdrawals.has(session)) {
            this.discardUndelivered(session, token, 'canceled');
            return;
        }
        session.authToken = token;
        session.failureStage = undefined;
        session.failureReason = undefined;
        session.primaryFailure = undefined;
        session.fallbackAttempted = undefined;
        session.state = 'confirmed';
        this.claims.set(session.key, { confirmedAt: this.now(), delivered: false });
        this.qrSessionStore.persist();
        this.nextQrAllowedAt = 0;
        this.lastQrFailure = undefined;
        logger.info('qq-auth.login-confirmed', {
            loginChannel: session.channel,
            hasCredential: true,
            credentialLoginType: credential.loginType,
            credentialKeys: Object.keys(credential).sort(),
            credentialKeyLength: credential.musickey.length,
        });
    }
    onQrEvent(session, event) {
        if (terminalState(session.state))
            return;
        const previousState = session.state;
        // A later WeChat waiting response is not evidence that the phone's scan was undone.
        // Keep the QQ listener's existing semantics and still accept cancellation/expiry events.
        if (session.channel === 'wechat' &&
            event.type === 'waiting' &&
            confirmingState(session.state)) {
            logWechatQr(session, 'qr-state', {
                eventType: 'waiting',
                previousState,
                state: session.state,
                ignored: true,
            });
            return;
        }
        if (event.type === 'waiting')
            session.state = 'waiting';
        else if (event.type === 'scanned')
            session.state = 'scanned';
        else if (event.type === 'cookies' || event.type === 'authorized') {
            const runtime = this.runtimeFor(session);
            // Started the same way for both driver modes. A push channel leaves it running in the
            // background exactly as before; a pull channel awaits it inside the same `advance()` so an
            // invocation never ends with the credential exchange still in flight.
            runtime.finalizing = this.finalizeLogin(session, event.payload).catch((error) => this.failSession(session, error, session.failureStage ?? 'credential-exchange'));
            void runtime.finalizing;
        }
        else if (['canceled', 'timeout', 'loginFailed'].includes(event.type ?? '')) {
            session.state = 'expired';
            session.failureStage = 'qr-event';
            session.failureReason =
                event.type === 'canceled'
                    ? 'user-canceled'
                    : event.type === 'timeout'
                        ? 'qr-timeout'
                        : 'login-rejected';
            session.retryAfterMs = this.backoff(session);
        }
        this.qrSessionStore.persist();
        if (session.channel === 'wechat' && session.state !== previousState) {
            const eventType = event.type === 'waiting' ||
                event.type === 'scanned' ||
                event.type === 'authorized' ||
                event.type === 'cookies' ||
                event.type === 'canceled' ||
                event.type === 'timeout' ||
                event.type === 'loginFailed'
                ? event.type
                : 'unknown';
            logWechatQr(session, 'qr-state', {
                eventType,
                previousState,
                state: session.state,
                ignored: false,
            });
        }
    }
    /**
     * Gives a pull channel its one time-boxed look at the upstream. Push channels have already
     * delivered whatever arrived, so this is a no-op for them.
     */
    async advanceSession(session, budgetMs) {
        const runtime = this.runtimeFor(session);
        if (runtime.driver.mode !== 'pull' || terminalState(session.state))
            return;
        let events;
        runtime.deadlineAt = this.now() + budgetMs;
        try {
            events = await runtime.driver.advance(session, budgetMs);
            runtime.pollErrors = 0;
        }
        catch (error) {
            // A dropped long poll is normal; only a run of them fails the session. This is the same
            // tolerance the self-driving WeChat loop applied before it became a pull driver.
            runtime.pollErrors += 1;
            if (runtime.pollErrors > MAX_CONSECUTIVE_POLL_ERRORS)
                this.failSession(session, error, 'qr-poll');
            return;
        }
        for (const event of events)
            this.onQrEvent(session, event);
        await runtime.finalizing;
    }
    async createSession(channel = DEFAULT_LOGIN_CHANNEL) {
        // Normalizing here rather than deeper in is what keeps the legacy alias a boundary concern:
        // every field, log and comparison below this line only ever sees a canonical channel.
        const loginChannel = normalizeLoginChannel(channel);
        // Validated against this runtime's declared capabilities, not a module-level constant, so a
        // runtime that cannot serve a channel rejects it instead of failing further in.
        if (!loginChannel || !this.capabilities.channels.includes(loginChannel))
            throw new QrLoginServiceError(`Unsupported QR login channel: ${channel}`, 400);
        this.cleanup();
        const retryAfterMs = Math.max(0, this.nextQrAllowedAt - this.now());
        if (retryAfterMs > 0)
            throw new QrLoginServiceError('QR login is temporarily backed off', 429, retryAfterMs, undefined, {
                failureStage: 'qr-key',
                failureReason: 'local-backoff',
                lastFailure: this.lastQrFailure,
            });
        // The concurrency lock and a QR that is mid-confirmation are the only real 409s left.
        if (this.creatingSession || this.confirmingQrExists())
            throw new QrLoginServiceError('Another QR login is already active', 409, undefined, undefined, {
                failureStage: 'qr-key',
                failureReason: 'session-busy',
            });
        this.discardPreemptibleSessions();
        this.creatingSession = true;
        let stage = 'device-bootstrap';
        try {
            const device = this.deviceStore.get();
            if (await ensureQimei(this.http, device, this.now()))
                this.deviceStore.persist();
            stage = 'session-bootstrap';
            await refreshAndroidSession(this.http, device);
            this.deviceStore.persist();
            const key = this.random(24).toString('hex');
            this.qrSessionStore.set({
                key,
                channel: loginChannel,
                state: 'created',
                createdAt: this.now(),
                expiresAt: this.now() + QR_TTL_MS,
            });
            logger.info('qq-auth.qr-session-created', { loginChannel });
            return key;
        }
        catch (error) {
            throw this.failBootstrap(error, stage);
        }
        finally {
            this.creatingSession = false;
        }
    }
    /**
     * Releases one QR session by key. Keyed on purpose: clearing every session would let one client
     * closing its dialog kill a QR another client is confirming on their phone.
     */
    cancelSession(key) {
        const session = this.qrSessionStore.get(key);
        // Idempotent by contract. The client cancels on dialog close as fire-and-forget, so an unknown
        // or already expired key is a success, never a 404.
        if (!session)
            return;
        // A confirmed session is left to expire on its own: the credential already reached authSessions
        // and a poll still in flight has to keep reading 803 rather than flip a login into "expired".
        if (session.state === 'confirmed')
            return;
        // 换凭证已经在路上：记下被取消，换完就不发会话（见 finalizeLogin），不留没人拿得到的凭证。
        if (session.state === 'exchanging')
            this.withdrawals.add(session);
        this.dropSession(session);
        logger.info('qq-auth.qr-session-canceled', { loginChannel: session.channel });
    }
    sessionHttp(session) {
        const runtime = this.runtimeFor(session);
        if (!runtime.http)
            runtime.http = this.createSessionHttp();
        return runtime.http;
    }
    async createQr(key) {
        const session = this.sessionFor(key);
        if (session.imageUrl)
            return session.imageUrl;
        if (session.state !== 'created')
            throw new QrLoginServiceError('QR session cannot create another code', 409);
        const runtime = this.runtimeFor(session);
        session.state = 'creating';
        let stage = 'qr-create';
        try {
            const qr = await runtime.driver.createQr(session);
            session.identifier = qr.identifier;
            if (isMqttLoginChannel(session.channel))
                session.qrcodeId = qr.identifier;
            session.imageUrl = qr.imageUrl;
            if (qr.expiresIn && qr.expiresIn > 0) {
                session.expiresAt = Math.min(session.expiresAt, this.now() + qr.expiresIn * 1000);
            }
            logger.info('qq-auth.qr-created', {
                loginChannel: session.channel,
                qrIdentifierLength: qr.identifier.length,
            });
            if (runtime.driver.start) {
                stage = 'mqtt-listener';
                // The listener deadline is still computed after `expiresIn` narrowed the record, which is
                // exactly the order the pre-driver implementation used.
                const listener = runtime.driver.start(session, {
                    onEvent: (event) => this.onQrEvent(session, event),
                    timeoutMs: session.expiresAt - this.now(),
                });
                runtime.listener = listener;
                void listener.done.catch((error) => this.failSession(session, error, 'mqtt-listener'));
                await listener.ready;
            }
            else {
                // A pull channel is scannable the moment the code exists. The self-driving loop it
                // replaces emitted this same event before its first poll.
                this.onQrEvent(session, { type: 'waiting', payload: null });
            }
            this.qrSessionStore.persist();
            return qr.imageUrl;
        }
        catch (error) {
            this.failSession(session, error, stage);
            throw new QrLoginServiceError('Unable to create QR login', 502, session.retryAfterMs, session.upstreamCode, failureDetailsOf(session));
        }
    }
    async checkQr(key, budgetMs = this.checkBudgetMs) {
        try {
            const session = this.sessionFor(key);
            await this.advanceSession(session, budgetMs);
            if (session.state === 'confirmed' && session.authToken) {
                const claim = this.claims.get(session.key);
                if (claim)
                    claim.delivered = true;
                return this.observedCheckResult(session, {
                    code: 803,
                    message: 'Authorization login successful',
                    cookie: `qqmusic_session=${session.authToken}`,
                });
            }
            if (session.state === 'scanned' || session.state === 'exchanging')
                return this.observedCheckResult(session, { code: 802, message: 'QR code scanned' });
            if (session.state === 'expired' || session.state === 'failed')
                return this.observedCheckResult(session, this.failedCheckResult(session));
            return this.observedCheckResult(session, { code: 801, message: 'Waiting for QR scan' });
        }
        catch (error) {
            // 找不到会话（过期、被取消、从没有过）照旧回过期；其他例外不能也说成过期，免得真正的原因被盖掉。
            if (error instanceof QrLoginServiceError && error.httpStatus === 404)
                return { code: 800, message: 'QR code expired' };
            logger.warn('qq-auth.qr-check-failed', {
                name: error instanceof Error ? error.name : 'Error',
            });
            return {
                code: 800,
                message: 'QR login failed',
                failureStage: 'qr-poll',
                failureReason: 'unexpected-error',
            };
        }
    }
    observedCheckResult(session, result) {
        if (session.channel !== 'wechat')
            return result;
        const failure = failureDetailsOf(session);
        logWechatQr(session, 'qr-check', {
            state: session.state,
            apiCode: result.code,
            sessionMode: this.capabilities.sessionMode,
            pollErrors: this.qrRuntimes.get(session.key)?.pollErrors ?? 0,
            failureStage: failure.failureStage,
            failureReason: failure.failureReason,
        });
        return result;
    }
    failedCheckResult(session) {
        return {
            code: 800,
            message: session.state === 'expired' ? 'QR code expired' : 'QR login failed',
            ...(session.retryAfterMs === undefined ? {} : { retryAfterMs: session.retryAfterMs }),
            ...failureDetailsOf(session),
        };
    }
    /**
     * `/login/status` 在没有可用会话时回 200 加一个空载荷，客户端靠 `data.profile` 在不在判断登录态。
     * 因此凭证被上游拒绝时这里回报「未登录」而不是抛错，让它和「根本没带 token」走同一条路；其余需要
     * 登录的路由仍然回 401。
     */
    async getLoginStatus(token) {
        const auth = await this.authFor(token);
        if (!auth)
            return null;
        try {
            return await withCredentialRejectionMapped(() => getLoginProfile(this.http, auth));
        }
        catch (error) {
            if (error instanceof AuthCredentialRejectedError) {
                // 对外照旧回「未登录」；只记上游给的码，方便分出是不是新凭证一换到就被拒。
                logger.warn('qq-auth.login-status-rejected', { upstreamCode: error.upstreamCode });
                return null;
            }
            throw error;
        }
    }
    async getUserDetail(token) {
        const auth = await this.authFor(token);
        return auth ? withCredentialRejectionMapped(() => getLoginProfile(this.http, auth)) : null;
    }
    async getUserPlaylists(token, uin, options = {}) {
        const auth = await this.authFor(token);
        if (!auth)
            return null;
        // 只支持登录账号本身：别人的 uid 以前会让自建歌单读对方、收藏歌单读自己，两边混在一起。
        if (uin !== undefined && uin.trim() !== '' && !isOwnAccountId(auth.credential, uin))
            throw new RequestRejectedError('uid must be the logged-in account');
        return withCredentialRejectionMapped(() => getPlaylists(this.http, auth, options.favoriteOffset ?? 0, options.playCount === true));
    }
    async getUserAlbums(token, offset, limit) {
        const auth = await this.authFor(token);
        return auth
            ? withCredentialRejectionMapped(() => getFavoriteAlbums(this.http, auth, offset, limit))
            : null;
    }
    async getUserLikedSongs(token, offset, limit) {
        const auth = await this.authFor(token);
        return auth
            ? withCredentialRejectionMapped(() => getLikedSongs(this.http, auth, offset, limit))
            : null;
    }
    async getOwnedPlaylistSongs(token, params = {}) {
        const auth = await this.authFor(token);
        return auth
            ? withCredentialRejectionMapped(() => getOwnedPlaylistSongs(this.http, auth, params))
            : null;
    }
    async getAuthenticatedSongListDetail(token, disstid, options = {}) {
        const id = positiveIdOf(disstid);
        if (!id)
            return null;
        const auth = await this.authFor(token);
        return auth
            ? withCredentialRejectionMapped(() => getAuthenticatedSongListDetail(this.http, auth, id, options.limit))
            : null;
    }
    async getMusicPlay(token, songmid, quality, mediaId, options) {
        const auth = await this.authFor(token);
        return auth
            ? withCredentialRejectionMapped(() => getAuthenticatedPlayUrls(this.http, auth, this.streamCdnSelector, songmid, quality, mediaId, options, this.playbackHintsEnabled, { enabled: this.playbackFallbackEnabled }))
            : null;
    }
    getEncryptedMusicPlay(auth, songmid, quality) {
        return withCredentialRejectionMapped(() => getEncryptedPlayUrls(this.http, auth, songmid, quality));
    }
    async resolveSession(token) {
        return this.authFor(token);
    }
    async lookupSession(token) {
        this.cleanup();
        if (this.sessionResolver.lookup)
            return this.sessionResolver.lookup(token);
        if (this.sessionResolver.mode === 'sealed')
            return this.sessionResolver.resolve(token);
        throw new QqApiError('unexpected');
    }
    getEncryptedMusicPlayWithinBudget(token, songmid, quality, signal) {
        return withBoundedPlaybackHttp(this.http, async (bounded) => {
            const auth = this.sessionResolver.awaitExistingRefresh
                ? await this.sessionResolver.awaitExistingRefresh(token)
                : await this.lookupSession(token);
            if (!auth)
                return null;
            return withCredentialRejectionMapped(() => getEncryptedPlayUrls(bounded, auth, songmid, quality, true));
        }, ENCRYPTED_PLAYBACK_LIMITS, signal);
    }
    /**
     * `POST /login/refresh`. Resolving already runs the stored silent refresh, which keeps the same
     * token; a sealed resolver additionally renews inside its final window and seals a new token.
     */
    async refreshSession(token) {
        const session = await this.authFor(token);
        if (!session || !token)
            return null;
        const rotation = await this.sessionResolver.rotate?.(token, (current) => refreshLoginCredential(this.http, current.device, current.credential));
        return rotation ?? { token, expiresAt: session.expiresAt, rotated: false };
    }
    /**
     * Electron's lifeline, unchanged in shape. A sealed resolver has no repository to swap, so the
     * call is a no-op there rather than an error: the hook exists for hosts that keep credentials on
     * the server, and a runtime that does not is not misconfigured for ignoring it.
     */
    configureAuthSessionRepository(repository) {
        this.sessionResolver.useRepository?.(repository);
    }
    /**
     * 只登出这一把会话：撤销 token，收掉用它确认的那个扫码。别的扫码（等待中、换凭证中、
     * 别人确认的）都不碰，取消扫码请用 cancelSession。
     */
    async logout(token) {
        if (!token)
            return;
        await this.sessionResolver.revoke(token);
        for (const session of this.qrSessionStore.values())
            if (session.authToken === token)
                this.dropSession(session);
    }
}
export const createQrLoginService = (dependencies = {}) => new QrLoginServiceImpl(dependencies);
