import { QqApiError, toNewRouteErrorResponse } from '../../protocol/errors.js';
import { playlistCreateResult, playlistDeleteResult } from '../../services/user/playlistManagement.js';
import { playlistRenameResult } from '../../services/user/playlistRename.js';
const writeHandler = (action) => async (request) => {
    if (request.method !== 'POST')
        return {
            status: 405,
            headers: { Allow: 'POST' },
            body: { code: 405, message: 'POST required' },
        };
    const session = await (await request.service()).resolveSession(request.token);
    if (!session)
        return toNewRouteErrorResponse(new QqApiError('auth-missing'));
    let body;
    try {
        body = await request.body?.();
    }
    catch {
        return toNewRouteErrorResponse(new QqApiError('input'));
    }
    return action(session, body);
};
export const playlistCreate = writeHandler(playlistCreateResult);
export const playlistDelete = writeHandler(playlistDeleteResult);
export const playlistRename = writeHandler(playlistRenameResult);
