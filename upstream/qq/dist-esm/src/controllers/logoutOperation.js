import { logout } from '../routes/operations/logout.js';
import { AUTH_COOKIE_NAME } from '../routes/sessionToken.js';
import { operationController } from './operation.js';
// src/controllers/logoutOperation.ts
// 登出的 Node 薄转接：继续用 Koa 原来的 Cookie API，保留 secure、签名和 overwrite 行为。
const commonLogout = operationController(logout);
export default async (ctx) => {
    await commonLogout(ctx);
    ctx.cookies.set(AUTH_COOKIE_NAME, '', { expires: new Date(0), overwrite: true });
};
