import { normalizeQqFailure, QqApiError, toNewRouteErrorResponse } from '../../protocol/errors.js';
import { ENCRYPTED_PLAYBACK_FILES, } from '../../protocol/playbackFiles.js';
import { validMediaIdOf } from '../../protocol/previewFile.js';
import { QqProtocolError } from '../../services/auth/musicuProtocol.js';
import { AuthCredentialRejectedError } from '../../util/authError.js';
import { GatewayCredentialConflictError } from '../../util/gatewayCredentialConflictError.js';
import { summarizeError } from '../../util/safeError.js';
const privateResult = ({ headers, ...response }) => ({
    ...response,
    headers: { ...headers, 'Cache-Control': 'private, no-store' },
});
const failureResponse = (error) => {
    if (error instanceof AuthCredentialRejectedError)
        return toNewRouteErrorResponse(new QqApiError('auth-missing', { upstreamCode: error.upstreamCode }));
    if (error instanceof QqApiError)
        return toNewRouteErrorResponse(error);
    if (error instanceof QqProtocolError || error instanceof GatewayCredentialConflictError)
        return toNewRouteErrorResponse(normalizeQqFailure({
            source: 'business',
            upstreamCode: error.upstreamCode,
            upstreamGlobalCode: error.globalCode,
            upstreamHttpStatus: error.httpStatus,
        }));
    const { status } = summarizeError(error);
    return toNewRouteErrorResponse(normalizeQqFailure(status === undefined
        ? { source: 'network', error }
        : { source: 'http', upstreamHttpStatus: status }));
};
export const getEncryptedMusicPlay = async (request) => {
    if (request.method && request.method !== 'GET')
        return privateResult({
            status: 405,
            headers: { Allow: 'GET' },
            body: { code: 405, message: 'Method not allowed' },
        });
    try {
        const songmid = validMediaIdOf(request.queryRaw('songmid'));
        const preview = request.queryRaw('preview');
        const quality = request.queryRaw('quality') ?? '192';
        if (!request.token)
            throw new QqApiError('auth-missing');
        const service = await request.service();
        const auth = await service.lookupSession(request.token);
        if (!auth)
            throw new QqApiError('auth-missing');
        if (!songmid ||
            Array.isArray(preview) ||
            preview === '1' ||
            preview === 'true' ||
            typeof quality !== 'string' ||
            !Object.hasOwn(ENCRYPTED_PLAYBACK_FILES, quality))
            throw new QqApiError('input');
        const playUrl = await service.getEncryptedMusicPlayWithinBudget(request.token, songmid, quality, request.signal);
        if (!playUrl)
            throw new QqApiError('auth-missing');
        return privateResult({ status: 200, headers: {}, body: { data: { playUrl } } });
    }
    catch (error) {
        return privateResult(failureResponse(error));
    }
};
