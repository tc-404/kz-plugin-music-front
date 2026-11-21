import { officialRadioModesResult, officialRadioTracksResult, } from '../../services/recommend/officialRadio.js';
import { rawQuery, requiredSession } from './requestValues.js';
// 普通雷达选项与批次只读；不把未知模式或分页参数收下后忽略。
const unsupportedQuery = (request) => ['page', 'cursor', 'mode', 'submode', 'scene_id'].some((key) => rawQuery(request, key) !== undefined);
export const getRadioRecommendationModes = async (request) => officialRadioModesResult(await requiredSession(request), unsupportedQuery(request) || rawQuery(request, 'id') !== undefined);
export const getRadioRecommendationTracks = async (request) => officialRadioTracksResult(await requiredSession(request), rawQuery(request, 'id'), unsupportedQuery(request));
