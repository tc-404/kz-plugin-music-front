import { qrCheck } from '../routes/operations/qrCheck.js';
import { AUTH_COOKIE_NAME, tokenFromCookieString } from '../routes/sessionToken.js';
import { operationController } from './operation.js';
const commonQrCheck = operationController(qrCheck);
// 继续用 Koa 的 Cookie API，保留安全连接、签名及覆盖行为。
export default async (ctx) => {
    await commonQrCheck(ctx);
    const result = ctx.body;
    if (result.code === 803 && result.cookie) {
        const token = tokenFromCookieString(result.cookie);
        if (token)
            ctx.cookies.set(AUTH_COOKIE_NAME, token, {
                httpOnly: true,
                maxAge: 86400000,
                overwrite: true,
                sameSite: 'lax',
            });
    }
};
