import { AUTH_COOKIE_NAME } from '../sessionToken.js';
// src/routes/operations/logout.ts
// 会话退出共用服务；Node 的 Cookie 留给 Koa 转接，sealed 客户端仍靠清除 Cookie 结束会话。
export const logout = async (request) => {
    await (await request.service()).logout(request.token);
    const headers = request.runtime === 'serverless'
        ? { 'set-cookie': `${AUTH_COOKIE_NAME}=; Max-Age=0; Path=/` }
        : {};
    return {
        status: 200,
        headers,
        body: { code: 200 },
    };
};
