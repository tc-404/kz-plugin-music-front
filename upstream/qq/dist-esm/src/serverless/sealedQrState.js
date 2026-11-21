import { isSupportedLoginChannel } from '../services/auth/qrLogin.js';
import { openToken, SEALED_QR_PURPOSE, SealedSessionError, sealToken } from './sealedSession.js';
const QR_IMAGE = /^data:image\/png;base64,[A-Za-z0-9+/]{1,8000}={0,2}$/;
const isDeviceState = (value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return false;
    const candidate = value;
    const optionalText = (key) => candidate[key] === undefined || typeof candidate[key] === 'string';
    return (optionalText('qimei') &&
        optionalText('qimei36') &&
        optionalText('sessionUid') &&
        optionalText('sessionSid') &&
        (candidate.qimeiSavedAt === undefined || Number.isFinite(candidate.qimeiSavedAt)));
};
const isSealedQrPayload = (value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return false;
    const candidate = value;
    return (candidate.v === 1 &&
        isSupportedLoginChannel(candidate.channel) &&
        Number.isFinite(candidate.createdAt) &&
        Number.isFinite(candidate.expiresAt) &&
        typeof candidate.identifier === 'string' &&
        candidate.identifier.length > 0 &&
        typeof candidate.cookies === 'string' &&
        isDeviceState(candidate.device) &&
        (candidate.image === undefined ||
            (typeof candidate.image === 'string' && QR_IMAGE.test(candidate.image))));
};
/** Seals a freshly created QR session's state into the token that becomes the client's `unikey`. */
export const sealQrState = (payload, secret) => sealToken({ v: 1, ...payload }, SEALED_QR_PURPOSE, secret);
/**
 * Opens a `unikey` back into the state it was sealed with. Answers `null` for anything that is not
 * a live, authentic QR token — tampered, foreign-purpose, unopenable with either secret, malformed,
 * or past `expiresAt` — so a caller can treat "no session" uniformly, exactly like `sessionFor` did
 * for the in-memory store this replaces.
 */
export const openQrState = async (token, secrets, now) => {
    let payload;
    try {
        payload = await openToken(token, SEALED_QR_PURPOSE, secrets);
    }
    catch (error) {
        if (error instanceof SealedSessionError)
            return null;
        throw error;
    }
    if (!isSealedQrPayload(payload))
        return null;
    if (payload.expiresAt <= now)
        return null;
    return payload;
};
