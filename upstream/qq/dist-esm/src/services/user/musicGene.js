import { normalizeQqFailure, QqApiError } from '../../protocol/errors.js';
import { isDictionary } from '../../util/values.js';
import { failureResult, okResult } from '../recommend/newRouteResult.js';
import { createSessionMusicuClient } from '../recommend/sessionMusicu.js';
export const userMusicGeneResult = async (session) => {
    try {
        if (!session)
            throw new QqApiError('auth-missing');
        const profile = await createSessionMusicuClient(session, { maxRetries: 0 }).execute({
            module: 'music.recommend.UserProfileSettingSvr',
            method: 'GetProfileReport',
            param: {},
            readOnly: true,
        });
        if (!isDictionary(profile))
            throw new QqApiError('invalid-response');
        if (profile.code !== undefined) {
            if (typeof profile.code !== 'number' || !Number.isSafeInteger(profile.code))
                throw new QqApiError('invalid-response');
            if (profile.code !== 0)
                throw normalizeQqFailure({ source: 'business', upstreamCode: profile.code });
        }
        // 只读当前会话本人，不转发目标账号，也不改变 IsVisitAccount 等上游字段的类型。
        return okResult({ profile });
    }
    catch (error) {
        return failureResult('get-user-music-gene', error);
    }
};
