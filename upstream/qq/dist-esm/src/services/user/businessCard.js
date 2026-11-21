import { normalizeQqFailure, QqApiError } from '../../protocol/errors.js';
import { isDictionary, stringOf } from '../../util/values.js';
import { failureResult, okResult } from '../recommend/newRouteResult.js';
import { createSessionMusicuClient } from '../recommend/sessionMusicu.js';
const decodeCard = (data) => {
    if (!isDictionary(data))
        throw new QqApiError('invalid-response');
    return data;
};
const readItems = (value, toItem) => {
    if (value === undefined || value === null)
        return [];
    if (!Array.isArray(value))
        throw new QqApiError('invalid-response');
    const items = value.map(toItem).filter((item) => item !== null);
    if (value.length > 0 && items.length === 0)
        throw new QqApiError('invalid-response');
    return items;
};
const toTag = (row) => {
    if (!isDictionary(row))
        return null;
    const name = stringOf(row.Name);
    if (!name)
        return null;
    const type = row.type;
    return {
        name,
        icon: stringOf(row.Icon),
        ...(typeof type === 'number' && Number.isSafeInteger(type) ? { type } : {}),
    };
};
const toFavoriteSong = (row) => {
    if (!isDictionary(row))
        return null;
    const id = stringOf(row.id);
    if (!id)
        return null;
    return {
        id,
        title: stringOf(row.mainText),
        subtitle: stringOf(row.descText),
        cover: stringOf(row.picURL),
    };
};
export const businessCardResult = async (session, options = {}) => {
    try {
        if (!session)
            throw new QqApiError('auth-missing');
        const encryptedUin = stringOf(session.credential.encryptUin);
        if (!encryptedUin)
            throw new QqApiError('unexpected');
        const descriptor = {
            module: 'music.homepage.HomepageShareSvr',
            method: 'GetMusicBusinessCard',
            param: { EncUin: encryptedUin },
            readOnly: true,
            operation: 'user.business-card',
            decode: decodeCard,
        };
        const data = await createSessionMusicuClient(session, options).execute(descriptor);
        for (const key of ['code', 'subcode', 'retcode']) {
            const code = data[key];
            if (code === undefined || code === 0)
                continue;
            if (typeof code !== 'number' || !Number.isSafeInteger(code))
                throw new QqApiError('invalid-response');
            throw normalizeQqFailure({ source: 'business', upstreamCode: code });
        }
        if (!isDictionary(data.User))
            throw new QqApiError('invalid-response');
        return okResult({
            nick: stringOf(data.User.Nick),
            avatar: stringOf(data.User.Headurl),
            tags: readItems(data.User.Tags, toTag),
            musicTags: readItems(data.MusicTags, toTag),
            favoriteSongs: readItems(data.FavoriteSongs, toFavoriteSong),
        });
    }
    catch (error) {
        return failureResult('get-business-card', error);
    }
};
