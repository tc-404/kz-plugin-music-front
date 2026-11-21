import { QqApiError } from '../../protocol/errors.js';
import { isDictionary } from '../../util/values.js';
import { failureResult, okResult } from '../recommend/newRouteResult.js';
import { createSessionMusicuClient } from '../recommend/sessionMusicu.js';
import { albumOwnerOf } from './albumOwner.js';
import { exactObjectOf } from './writeInput.js';
export const albumSubscribeResult = async (session, raw, options = {}) => {
    try {
        if (!session)
            throw new QqApiError('auth-missing');
        const input = exactObjectOf(raw, ['id', 'subscribed']);
        if (typeof input.id !== 'string' ||
            !/^[A-Za-z0-9]{1,64}$/.test(input.id) ||
            typeof input.subscribed !== 'boolean')
            throw new QqApiError('input');
        const id = input.id, subscribed = input.subscribed;
        const { uin, statusUin } = albumOwnerOf(session.credential);
        const client = createSessionMusicuClient(session, { ...options, maxRetries: 0 });
        const read = () => client.execute({
            module: 'music.musicasset.AlbumFavRead',
            method: 'IsAlbumFan',
            param: { uin: statusUin, v_albumMid: [id] },
            readOnly: true,
            operation: 'subscription.album-status',
            decode: (data) => {
                if (!isDictionary(data) ||
                    !isDictionary(data.m_fan) ||
                    typeof data.m_fan[id] !== 'boolean')
                    throw new QqApiError('invalid-response');
                return data.m_fan[id];
            },
        });
        if ((await read()) === subscribed)
            return okResult({ subscribed });
        await client.execute({
            module: 'music.musicasset.AlbumFavWrite',
            method: subscribed ? 'FavAlbum' : 'CancelFavAlbum',
            param: { uin, v_albumMid: [id] },
            readOnly: false,
            operation: subscribed ? 'album.subscribe' : 'album.unsubscribe',
            decode: (data) => {
                if (!isDictionary(data) ||
                    data.result !== 0 ||
                    !Array.isArray(data.v_failedAlbumId) ||
                    data.v_failedAlbumId.length ||
                    !Array.isArray(data.v_failedAlbumMid) ||
                    data.v_failedAlbumMid.length)
                    throw new QqApiError('invalid-response');
                return undefined;
            },
        });
        if ((await read()) !== subscribed)
            throw new QqApiError('invalid-response');
        return okResult({ subscribed });
    }
    catch (error) {
        const safe = error instanceof QqApiError
            ? error.kind === 'rate-limited'
                ? new QqApiError('upstream-business', {
                    ...error.toJSON(),
                    errorKey: 'upstream.unknown',
                    retryable: false,
                })
                : error
            : new QqApiError('invalid-response');
        const result = failureResult('album-subscribe', safe);
        return { ...result, body: { ...result.body, retryable: false } };
    }
};
