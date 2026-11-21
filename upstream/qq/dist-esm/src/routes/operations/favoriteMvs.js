import { favoriteMvsResult } from '../../services/user/favoriteMvs.js';
import { rawQuery, requiredSession } from './requestValues.js';
// 本人收藏的 MV：上游没有分页，page 只能省略或是 1。
export const getFavoriteMvs = async (request) => favoriteMvsResult(await requiredSession(request), rawQuery(request, 'page'));
