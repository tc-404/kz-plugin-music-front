import { normalizeQqFailure, QqApiError } from '../../protocol/errors.js';
import { isDictionary } from '../../util/values.js';
import { failureResult, okResult } from './newRouteResult.js';
import { createSessionMusicuClient } from './sessionMusicu.js';
// 分类黑名单的已观察首屏与单曲风格选项；不猜测完整游标、Token 或 Status 的含义。
const KINDS = {
    song: { cmd: 3, field: 'Songs' },
    singer: { cmd: 2, field: 'Singers' },
    style: { cmd: 4, field: 'Styles' },
};
const readFeedback = async (session, method, param) => {
    const data = await createSessionMusicuClient(session, { maxRetries: 0 }).execute({
        module: 'music.feedback.FeedbackBlack',
        method,
        param,
        readOnly: true,
        operation: 'recommend.blacklist-read',
    });
    if (!isDictionary(data))
        throw new QqApiError('invalid-response');
    return data;
};
const identity = (value) => {
    if (!isDictionary(value) ||
        typeof value.ID !== 'string' ||
        !value.ID ||
        !Number.isSafeInteger(value.IdType) ||
        typeof value.Name !== 'string')
        throw new QqApiError('invalid-response');
    return { id: value.ID, idType: value.IdType, name: value.Name };
};
export const blacklistResult = async (session, rawType, page, cursor) => {
    try {
        if (!session)
            throw new QqApiError('auth-missing');
        if (typeof rawType !== 'string' ||
            !Object.hasOwn(KINDS, rawType) ||
            (page !== undefined && page !== '1') ||
            cursor !== undefined)
            throw new QqApiError('input');
        const kind = KINDS[rawType];
        const data = await readFeedback(session, 'GetDislikeList', {
            Cmd: kind.cmd,
            Page: 1,
            SongLastid: 0,
            SingersLastid: 0,
        });
        if (!Number.isSafeInteger(data.Retcode))
            throw new QqApiError('invalid-response');
        if (data.Retcode !== 0)
            throw normalizeQqFailure({ source: 'business', upstreamCode: data.Retcode });
        const entries = data[kind.field];
        if (!Array.isArray(entries))
            throw new QqApiError('invalid-response');
        const items = entries.map((entry) => {
            const id = identity(entry);
            if (!isDictionary(entry) ||
                typeof entry.Img !== 'string' ||
                !Number.isSafeInteger(entry.Time))
                throw new QqApiError('invalid-response');
            return { ...id, image: entry.Img, time: entry.Time };
        });
        // 没有经过验证的终页条件；空首屏同样不能证明整份清单为空。
        return okResult({ type: rawType, items, coverage: 'first-page', complete: false });
    }
    catch (error) {
        return failureResult('get-blacklist', error);
    }
};
export const blacklistStyleOptionsResult = async (session, rawSong) => {
    try {
        if (!session)
            throw new QqApiError('auth-missing');
        if (typeof rawSong !== 'string' ||
            !/^[1-9]\d*$/.test(rawSong) ||
            !Number.isSafeInteger(Number(rawSong)))
            throw new QqApiError('input');
        const data = await readFeedback(session, 'GetDislikeConfigStyles', { Song: Number(rawSong) });
        if (!Array.isArray(data.Styles))
            throw new QqApiError('invalid-response');
        const styles = data.Styles.map((entry) => {
            const id = identity(entry);
            if (!isDictionary(entry) || !Number.isSafeInteger(entry.Status))
                throw new QqApiError('invalid-response');
            return { ...id, status: entry.Status };
        });
        return okResult({ styles });
    }
    catch (error) {
        return failureResult('get-blacklist-style-options', error);
    }
};
