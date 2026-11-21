import { normalizeQqFailure, QqApiError } from '../../protocol/errors.js';
import { dictionaryOf } from '../../util/values.js';
import { exactObjectOf } from '../user/writeInput.js';
import { blacklistResult, blacklistStyleOptionsResult } from './blacklistReads.js';
import { failureResult, okResult } from './newRouteResult.js';
import { createSessionMusicuClient } from './sessionMusicu.js';
const KINDS = ['song', 'singer', 'style'];
const FIELDS = { song: 'Songs', singer: 'Singers', style: 'Styles' };
const idOf = (value) => {
    if (typeof value !== 'string' || !/^[1-9]\d{0,39}$/.test(value))
        throw new QqApiError('input');
    return value;
};
const idTypeOf = (value) => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
        throw new QqApiError('input');
    return value;
};
const rowsOf = (value) => {
    if (value === undefined)
        return [];
    if (!Array.isArray(value) || value.length > 20)
        throw new QqApiError('input');
    return value;
};
const addInput = (raw) => {
    const input = exactObjectOf(raw, ['songs', 'singers', 'styles', 'songId']);
    const targets = [];
    for (const [key, type] of [
        ['songs', 'song'],
        ['singers', 'singer'],
    ])
        for (const value of rowsOf(input[key]))
            targets.push({ type, id: idOf(value) });
    for (const value of rowsOf(input.styles)) {
        const style = exactObjectOf(value, ['id', 'idType']);
        targets.push({ type: 'style', id: idOf(style.id), idType: idTypeOf(style.idType) });
    }
    if (!targets.length || targets.length > 30)
        throw new QqApiError('input');
    const keys = targets.map((t) => `${t.type}:${t.id}:${t.idType ?? ''}`);
    if (new Set(keys).size !== keys.length)
        throw new QqApiError('input');
    let songId;
    if (targets.some((t) => t.type === 'style')) {
        songId = idOf(input.songId);
        if (!Number.isSafeInteger(Number(songId)))
            throw new QqApiError('input');
    }
    else if (input.songId !== undefined)
        throw new QqApiError('input');
    return { targets, songId };
};
const mark = (result, state) => state.attempted
    ? {
        ...result,
        body: {
            ...dictionaryOf(result.body),
            retryable: false,
            writeAttempted: true,
            accepted: state.accepted,
            verified: false,
            verification: 'unconfirmed',
        },
    }
    : result;
const write = async (session, action, param, state) => {
    state.attempted = true;
    const data = await createSessionMusicuClient(session, { maxRetries: 0 }).execute({
        module: 'music.feedback.FeedbackBlack',
        method: action === 'add' ? 'AddDislike' : 'CancelDislike',
        param,
        readOnly: false,
        operation: action === 'add' ? 'recommend.blacklist-add' : 'recommend.blacklist-remove',
    });
    const body = dictionaryOf(data);
    if (!Number.isSafeInteger(body.Retcode))
        throw new QqApiError('invalid-response');
    if (body.Retcode !== 0)
        throw normalizeQqFailure({ source: 'business', upstreamCode: body.Retcode });
    state.accepted = true;
};
const itemsOf = (result) => dictionaryOf(result.body).items.map(dictionaryOf);
const matches = (target, item) => item.id === target.id && (target.idType === undefined || item.idType === target.idType);
export const blacklistAddResult = async (session, raw) => {
    const state = { attempted: false, accepted: false };
    try {
        if (!session)
            throw new QqApiError('auth-missing');
        const { targets, songId } = addInput(raw);
        const param = {};
        let choices = [];
        if (songId !== undefined) {
            const options = await blacklistStyleOptionsResult(session, songId);
            if (options.status !== 200)
                return options;
            choices = dictionaryOf(options.body).styles.map(dictionaryOf);
        }
        for (const type of KINDS) {
            const selected = targets.filter((t) => t.type === type);
            if (!selected.length)
                continue;
            param[FIELDS[type]] = selected.map((target) => {
                if (type !== 'style')
                    return { ID: target.id };
                const choice = choices.find((item) => matches(target, item));
                if (!choice)
                    throw new QqApiError('input');
                // 观察的8个风格新增条目Img均为空；名称取本曲候选，不信任调用方伪造的名称或分类。
                return { ID: target.id, IdType: target.idType, Name: choice.name, Img: '' };
            });
        }
        await write(session, 'add', param, state);
        const results = [];
        for (const type of KINDS) {
            const selected = targets.filter((t) => t.type === type);
            if (!selected.length)
                continue;
            const read = await blacklistResult(session, type, undefined, undefined);
            if (read.status !== 200)
                return mark(read, state);
            const items = itemsOf(read);
            for (const target of selected)
                results.push({
                    ...target,
                    intent: type === 'style' ? 'reduce-style' : 'dislike',
                    state: items.some((item) => matches(target, item)) ? 'present' : 'not-seen-in-first-page',
                });
        }
        const verified = results.every((r) => r.state === 'present');
        return okResult({
            accepted: true,
            verified,
            writeAttempted: true,
            verification: verified ? 'confirmed' : 'unconfirmed',
            coverage: 'first-page',
            complete: false,
            results,
        });
    }
    catch (error) {
        return mark(failureResult('blacklist-add', error), state);
    }
};
export const blacklistRemoveResult = async (session, raw) => {
    const state = { attempted: false, accepted: false };
    try {
        if (!session)
            throw new QqApiError('auth-missing');
        const input = exactObjectOf(raw, ['type', 'id', 'idType']);
        if (!KINDS.includes(input.type))
            throw new QqApiError('input');
        const target = {
            type: input.type,
            id: idOf(input.id),
            idType: idTypeOf(input.idType),
        };
        const before = await blacklistResult(session, target.type, undefined, undefined);
        if (before.status !== 200)
            return before;
        const item = itemsOf(before).find((row) => matches(target, row));
        if (!item) {
            const result = failureResult('blacklist-remove', new QqApiError('not-found'));
            return {
                ...result,
                body: { ...dictionaryOf(result.body), coverage: 'first-page', complete: false },
            };
        }
        const entry = {
            ID: item.id,
            Name: item.name,
            Img: item.image,
            IdType: item.idType,
            Time: item.time,
        };
        await write(session, 'remove', {
            Songs: target.type === 'song' ? [entry] : [],
            Singers: target.type === 'singer' ? [entry] : [],
            Styles: target.type === 'style' ? [entry] : [],
            OnlyAdd: 1,
        }, state);
        const after = await blacklistResult(session, target.type, undefined, undefined);
        if (after.status !== 200)
            return mark(after, state);
        const present = itemsOf(after).some((row) => matches(target, row));
        // 没有完整遍历契约，不能把首屏消失升级为 verified removed。
        return okResult({
            accepted: true,
            verified: false,
            writeAttempted: true,
            verification: 'unconfirmed',
            coverage: 'first-page',
            complete: false,
            results: [
                { ...target, intent: 'remove', state: present ? 'present' : 'not-seen-in-first-page' },
            ],
        });
    }
    catch (error) {
        return mark(failureResult('blacklist-remove', error), state);
    }
};
