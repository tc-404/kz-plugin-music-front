import { dailyHistoryDatesResult, dailyHistorySongsResult, } from '../../services/recommend/dailyHistory.js';
import { rawQuery, requiredSession } from './requestValues.js';
// 日推历史只读当前账号；指定日与日期目录使用不同路径，两个宿主共用同一实现。
export const dailyHistoryDates = async (request) => dailyHistoryDatesResult(await requiredSession(request));
export const dailyHistorySongs = async (request) => dailyHistorySongsResult(await requiredSession(request), rawQuery(request, 'date'));
