import { guessYouLikeModesResult } from '../../services/recommend/guessYouLikeModes.js';
import { rawQuery, requiredSession } from './requestValues.js';
// id 99 的模式目录只读；选择、分页或场景参数不收下后忽略。
export const getGuessYouLikeModes = async (request) => guessYouLikeModesResult(await requiredSession(request), ['id', 'page', 'cursor', 'mode', 'scene_id', 'pool_id'].some((key) => rawQuery(request, key) !== undefined));
