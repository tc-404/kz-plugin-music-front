import { QqApiError } from '../../protocol/errors.js';
import { hasKnownUnplayableTraits } from '../../protocol/playbackHints.js';
import { AuthCredentialRejectedError } from '../../util/authError.js';
import { dictionaryOf, isDictionary } from '../../util/values.js';
import { failureResult, okResult } from '../recommend/newRouteResult.js';
import { songVersionsResult } from './versions.js';
const MAX_CANDIDATES = 3;
const REPLACEABLE_HINTS = ['playback.maybe-region-restricted', 'playback.maybe-membership'];
const midOf = (raw) => {
    const mid = typeof raw === 'string' ? raw.trim() : '';
    if (!/^[A-Za-z0-9]{1,64}$/.test(mid))
        throw new QqApiError('input');
    return mid;
};
const urlOf = (entry) => {
    const url = dictionaryOf(entry).url;
    return typeof url === 'string' ? url : '';
};
const hintOf = (entry) => {
    const key = dictionaryOf(dictionaryOf(dictionaryOf(entry).restriction).hint).key;
    return typeof key === 'string' ? key : null;
};
const read = async (readPlayUrls, mids) => {
    const urls = await readPlayUrls(mids);
    if (!urls)
        throw new QqApiError('auth-missing');
    return urls;
};
export const songReplacementResult = async (session, rawMid, readPlayUrls) => {
    try {
        if (!session)
            throw new QqApiError('auth-missing');
        const mid = midOf(rawMid);
        const originalEntry = (await read(readPlayUrls, [mid]))[mid];
        const playable = urlOf(originalEntry) !== '';
        const hint = playable ? null : hintOf(originalEntry);
        const original = { mid, playable, hint };
        if (playable)
            return okResult({ original, song: null, reason: 'original-playable' });
        if (!hint || !REPLACEABLE_HINTS.includes(hint))
            return okResult({ original, song: null, reason: 'reason-unconfirmed' });
        const versions = await songVersionsResult({ mid });
        if (versions.status === 422)
            return okResult({ original, song: null, reason: 'no-other-version' });
        if (versions.status !== 200)
            return versions;
        const candidates = dictionaryOf(versions.body).songs
            .filter(isDictionary)
            .filter((song) => typeof song.mid === 'string' && /^[A-Za-z0-9]{1,64}$/.test(song.mid) && song.mid !== mid)
            .sort((a, b) => Number(hasKnownUnplayableTraits(a)) - Number(hasKnownUnplayableTraits(b)))
            .slice(0, MAX_CANDIDATES);
        if (!candidates.length)
            return okResult({ original, song: null, reason: 'no-playable-version' });
        const urls = await read(readPlayUrls, candidates.map((song) => song.mid));
        const song = candidates.find((candidate) => urlOf(urls[candidate.mid]) !== '');
        if (!song)
            return okResult({ original, song: null, reason: 'no-playable-version' });
        const subtitle = typeof song.subtitle === 'string' ? song.subtitle.trim() : '';
        return okResult({ original, song, ...(subtitle ? { label: subtitle } : {}) });
    }
    catch (error) {
        return failureResult('get-song-replacement', error instanceof AuthCredentialRejectedError ? new QqApiError('auth-missing') : error);
    }
};
