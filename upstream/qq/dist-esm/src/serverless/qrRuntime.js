import { createMemoryDeviceContextRepository } from '../services/auth/deviceContextStore.js';
import { createPtloginQrDriver } from '../services/auth/qrDrivers.js';
import { createRelayQqQrDriver, } from '../services/auth/qrLogin.js';
import { isMqttLoginChannel } from '../services/auth/qrTypes.js';
import { deriveAndroidDevice } from './derivedDevice.js';
// 一次 /login/qr/check 最多做多久；Folia 等登录请求 20 秒，这里留出余量。
export const CHECK_BUDGET_MS = 15_000;
export const secretsOf = (env) => ({
    current: env.QQ_SESSION_SECRET ?? '',
    previous: env.QQ_SESSION_SECRET_PREVIOUS,
});
/** 没有 relay 时手机 QQ 走纯 HTTP 扫码；默认开，`QQ_PTLOGIN_HTTP_ENABLED` 设 `0` 或 `false` 才关。 */
export const ptloginEnabled = (env) => !['0', 'false'].includes((env.QQ_PTLOGIN_HTTP_ENABLED ?? '').trim().toLowerCase());
/** 这个部署的 `qq` 通道是不是纯 HTTP 扫码（有 relay 时照旧走 MQTT）。 */
export const usesPtlogin = (options, env) => !options.qqRelay && ptloginEnabled(env);
/**
 * 🔴 The single place this runtime decides what it can serve. Three call sites used to hard-code
 * `['wechat']` independently; deriving all of them from the injected relay is what makes "no relay
 * means no `qq`" impossible to get half-right. 没有 relay 时 `qq` 改走纯 HTTP 扫码；`qqmusic`
 * 只有 MQTT 这一套，所以还是要 relay。
 */
export const capabilitiesFor = (options, env = {}) => ({
    channels: options.qqRelay
        ? ['qq', 'wechat', 'qqmusic']
        : usesPtlogin(options, env)
            ? ['qq', 'wechat']
            : ['wechat'],
    sessionMode: 'sealed',
});
/**
 * The MQTT drivers (`qq`, and `qqmusic` on the same flow) exist only when a relay does; `wechat`
 * keeps the service's own default.
 */
export const driversFor = (options, http, deviceRepository, base, env = {}) => {
    const relay = options.qqRelay;
    if (!relay)
        return usesPtlogin(options, env) ? { qq: createPtloginQrDriver() } : undefined;
    const relayDriver = () => createRelayQqQrDriver({
        http,
        // Read through the repository rather than captured: `createSession` bootstraps QIMEI and
        // the Android session and persists them, so the device the QR is created with has to be
        // the post-bootstrap one, not the deterministic base this repository was seeded with.
        device: () => deviceRepository.load() ?? base,
        relay,
    });
    return { qq: relayDriver(), qqmusic: relayDriver() };
};
/**
 * A `QrSessionRepository` that answers `load()` with exactly the record a sealed `unikey` was
 * opened into, and never actually persists anything `/login/qr/create` or `/login/qr/check`
 * mutate — there is nowhere to write it back to, and nothing past this one call needs it.
 */
export const replayQrSessionRepository = (records) => ({
    kind: 'sealed-replay',
    load: () => records,
    save: () => undefined,
});
/**
 * Rebuilds one QR record from a sealed payload.
 *
 * 🔴 `qrcodeId` is not a duplicate of `identifier`: `exchangeQqLogin` reads *that* field as the
 * `qrCodeID` exchange parameter, and a record that carries only `identifier` fails at the very last
 * step of a successful scan — after the user has already approved on their phone. The App channel
 * is the only one where the two fields both apply, which is why `createQr` sets both.
 */
export const replayedRecord = (key, payload, state) => ({
    key,
    channel: payload.channel,
    state,
    createdAt: payload.createdAt,
    expiresAt: payload.expiresAt,
    identifier: payload.identifier,
    ...(isMqttLoginChannel(payload.channel) ? { qrcodeId: payload.identifier } : {}),
    // 纯 HTTP 扫码的图跟着 unikey 走；有了它，`/login/qr/create` 就不会再去要一张新码。
    ...(payload.image ? { imageUrl: payload.image } : {}),
});
/**
 * A `QrSessionRepository` that starts empty and remembers the last thing saved into it, so
 * `/login/qr/key` can read back the record `createSession` + `createQr` just built — the state
 * that has to be sealed into the `unikey` — without `QrLoginService` exposing it directly.
 */
export const capturingQrSessionRepository = () => {
    let saved = [];
    return {
        repository: {
            kind: 'sealed-capture',
            load: () => [],
            save: (sessions) => {
                saved = sessions.slice();
            },
        },
        latest: () => saved,
    };
};
/** Layers the live fields a fresh isolate cannot re-derive onto the deterministic base device. */
const withQrDeviceState = (base, saved) => saved
    ? {
        ...base,
        ...(saved.qimei === undefined ? {} : { qimei: saved.qimei }),
        ...(saved.qimei36 === undefined ? {} : { qimei36: saved.qimei36 }),
        ...(saved.qimeiSavedAt === undefined ? {} : { qimeiSavedAt: saved.qimeiSavedAt }),
        ...(saved.sessionUid === undefined ? {} : { sessionUid: saved.sessionUid }),
        ...(saved.sessionSid === undefined ? {} : { sessionSid: saved.sessionSid }),
        ...(saved.sessionVkey === undefined ? {} : { sessionVkey: saved.sessionVkey }),
    }
    : base;
export const qrDeviceRepositoryFor = async (secrets, saved) => {
    const base = withQrDeviceState(await deriveAndroidDevice(secrets.current), saved);
    return { repository: createMemoryDeviceContextRepository(base), base };
};
