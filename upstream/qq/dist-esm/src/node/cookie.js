/*
 * @Author: Rainy [https://github.com/rain120]
 * @Date: 2021-01-23 16:19:21
 * @LastEditors: Rainy
 * @LastEditTime: 2021-06-19 22:20:01
 */
import { userInfo } from '../config/index.js';
export default () => async (ctx, next) => {
    if (userInfo.cookie) {
        ctx.request.cookie = userInfo.cookie;
    }
    const cookieHeader = ctx.request.headers;
    if (cookieHeader && userInfo.cookieList) {
        userInfo.cookieList.forEach((cookie) => {
            const [key, value = ''] = cookie.split('=');
            if (value) {
                ctx.cookies.set(key, value.trim(), {
                    maxAge: 24 * 60 * 60 * 1000,
                    // overwirte: true,
                });
            }
        });
    }
    await next();
};
