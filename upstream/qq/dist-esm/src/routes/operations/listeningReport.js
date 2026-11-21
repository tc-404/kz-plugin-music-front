import { listeningReportResult } from '../../services/recommend/listeningReport.js';
import { rawQuery, requiredSession } from './requestValues.js';
// 本人的听歌报告：range 必填，date 可选。和 /user/listening-rank（歌曲排行）分开。
export const getListeningReport = async (request) => listeningReportResult(await requiredSession(request), {
    range: rawQuery(request, 'range'),
    date: rawQuery(request, 'date'),
});
