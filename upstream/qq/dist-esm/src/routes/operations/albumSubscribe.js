import { QqApiError, toNewRouteErrorResponse } from '../../protocol/errors.js';
import { albumSubscribeResult } from '../../services/user/albumSubscribe.js';
export const albumSubscribe = async (request) => {
    if (request.method !== 'POST')
        return {
            status: 405,
            headers: { Allow: 'POST' },
            body: { code: 405, message: 'POST required' },
        };
    const session = await (await request.service()).resolveSession(request.token);
    if (!session)
        return toNewRouteErrorResponse(new QqApiError('auth-missing'));
    try {
        return albumSubscribeResult(session, await request.body?.());
    }
    catch {
        return toNewRouteErrorResponse(new QqApiError('input'));
    }
};
