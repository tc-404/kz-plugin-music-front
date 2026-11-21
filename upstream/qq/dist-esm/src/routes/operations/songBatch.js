import { QqApiError, toNewRouteErrorResponse } from '../../protocol/errors.js';
import { songBatchResult } from '../../services/song/batch.js';
export const songBatch = async (request) => {
    if (request.method !== 'POST')
        return {
            status: 405,
            headers: { Allow: 'POST' },
            body: { code: 405, message: 'POST required' },
        };
    let body;
    try {
        body = await request.body?.();
    }
    catch {
        return toNewRouteErrorResponse(new QqApiError('input'));
    }
    return songBatchResult(body);
};
