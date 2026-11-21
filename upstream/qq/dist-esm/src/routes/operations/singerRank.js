import { singerRankResult } from '../../services/user/singerRank.js';
import { rawQuery, requiredSession } from './requestValues.js';
// 本人的歌手榜：range 必填（year、all、month、last-year）。
export const getSingerRank = async (request) => singerRankResult(await requiredSession(request), rawQuery(request, 'range'));
