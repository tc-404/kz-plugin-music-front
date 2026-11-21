import { logger } from '../../util/logger.js';
// src/services/auth/qrDiagnostics.ts
const attempts = new WeakMap();
let nextAttemptId = 0;
const COOKIE_NAME = /^[A-Za-z0-9_]{1,40}$/;
const COOKIE_NAME_LIMIT = 20;
/**
 * MQTT 通道（手机 QQ、QQ 音乐 App）收到 `cookies` 时，只记录 cookie 名称和 `tmeLoginType` 的数字。
 * 用来分辨不同 App、不同账号类型扫码时回调内容有什么不同；任何 cookie 的值都不记录。
 */
export const logQqCookies = (payload, loginChannel = 'qq') => {
    try {
        const body = payload !== null && typeof payload === 'object' ? payload : {};
        const cookies = body.cookies !== null && typeof body.cookies === 'object' && !Array.isArray(body.cookies)
            ? body.cookies
            : {};
        const cookieNames = Object.keys(cookies)
            .filter((name) => COOKIE_NAME.test(name))
            .sort()
            .slice(0, COOKIE_NAME_LIMIT);
        const entry = cookies.tmeLoginType;
        const raw = entry !== null && typeof entry === 'object'
            ? entry.value
            : undefined;
        const tmeLoginType = typeof raw === 'number' && Number.isSafeInteger(raw)
            ? raw
            : typeof raw === 'string' && /^\d{1,3}$/.test(raw)
                ? Number(raw)
                : undefined;
        // 账号 id 只记位数：微信账号是 19 位，超过 JavaScript 能精确表示的整数，排查换凭证时要知道。
        const uinEntry = cookies.qqmusic_uin;
        const uin = uinEntry !== null && typeof uinEntry === 'object'
            ? uinEntry.value
            : undefined;
        const uinDigits = typeof uin === 'string' && /^\d{1,30}$/.test(uin) ? uin.length : undefined;
        logger.info('qq-auth.qq-cookies', {
            loginChannel,
            cookieNames,
            ...(tmeLoginType === undefined ? {} : { tmeLoginType }),
            ...(uinDigits === undefined ? {} : { uinDigits }),
            hasCommConf: body.commConf !== null && typeof body.commConf === 'object',
        });
    }
    catch {
        // Optional host log sinks must never turn a valid login into a failure.
    }
};
/** A process-local counter correlates one attempt without deriving anything from a QR or account. */
export const logWechatQr = (session, event, fields) => {
    if (session.channel !== 'wechat')
        return;
    let attemptId = attempts.get(session);
    if (attemptId === undefined) {
        attemptId = ++nextAttemptId;
        attempts.set(session, attemptId);
    }
    try {
        logger.info(`qq-auth.wechat-${event}`, { attemptId, loginChannel: 'wechat', ...fields });
    }
    catch {
        // Optional host log sinks must never turn a valid poll or login into a failure.
    }
};
