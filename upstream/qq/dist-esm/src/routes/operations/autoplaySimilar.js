import { similarAutoplayResult } from '../../services/recommend/autoplay.js';
import { rawQuery, requiredSession } from './requestValues.js';
// 相似歌曲接歌：只收一首种子歌的数字 id。
export const getAutoplaySimilar = async (request) => similarAutoplayResult(await requiredSession(request), rawQuery(request, 'id'));
