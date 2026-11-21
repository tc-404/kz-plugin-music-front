import { medalsResult } from '../../services/user/medals.js';
import { rawQuery, requiredSession } from './requestValues.js';
// 本人勋章馆的一个分页：tab 必填，用分页名字。
export const getMedals = async (request) => medalsResult(await requiredSession(request), rawQuery(request, 'tab'));
