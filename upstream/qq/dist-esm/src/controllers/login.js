import { AUTH_COOKIE_NAME, AUTH_HEADER_NAME, tokenFromCookieString } from '../routes/sessionToken.js';
import { getTypedQuery } from '../types/core/request.js';
/**
 * Priority is header > query > cookie. The two existing sources keep their relative order and
 * their exact behaviour, so external callers and Electron — which both send `?cookie=` — are
 * unaffected by the addition.
 */
export const getAuthToken = (ctx) => {
    const header = ctx.get(AUTH_HEADER_NAME).trim();
    if (header)
        return header;
    const query = getTypedQuery(ctx);
    return tokenFromCookieString(String(query.cookie ?? '')) || ctx.cookies.get(AUTH_COOKIE_NAME);
};
