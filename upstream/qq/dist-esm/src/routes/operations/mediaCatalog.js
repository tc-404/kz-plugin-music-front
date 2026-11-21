import { commentCountResult, hotCommentsResult, newCommentsResult, } from '../../services/comments/catalog.js';
import { mvDetailResult, mvListResult, mvUrlResult, songMvsResult, } from '../../services/mv/catalog.js';
import { songLabelsResult } from '../../services/recommend/songLabels.js';
import { similarSingersResult, singerDetailResult, singerHomepageResult, singerListResult, singerMvsResult, singerSongsResult, } from '../../services/singers/catalog.js';
import { optionalSession, rawQuery } from './requestValues.js';
// src/routes/operations/mediaCatalog.ts
//
// 歌手、歌曲评论、MV、歌曲标签：公开内容，没设会话密钥也能用。除了 MV 播放链接有会话就带凭证读，其余一律匿名。
const pageOf = (request, key) => ({
    [key]: rawQuery(request, key),
    offset: rawQuery(request, 'offset'),
    limit: rawQuery(request, 'limit'),
});
export const listSingers = (request) => singerListResult({
    area: rawQuery(request, 'area'),
    sex: rawQuery(request, 'sex'),
    genre: rawQuery(request, 'genre'),
    index: rawQuery(request, 'index'),
    offset: rawQuery(request, 'offset'),
    limit: rawQuery(request, 'limit'),
});
export const getSingerDetail = (request) => singerDetailResult(rawQuery(request, 'mid'));
export const getSingerHomepage = (request) => singerHomepageResult(rawQuery(request, 'mid'));
export const getSimilarSingers = (request) => similarSingersResult(rawQuery(request, 'mid'));
export const getSingerSongs = (request) => singerSongsResult(pageOf(request, 'mid'));
export const getSingerMvs = (request) => singerMvsResult(pageOf(request, 'mid'));
export const getHotComments = (request) => hotCommentsResult(pageOf(request, 'id'));
export const getNewComments = (request) => newCommentsResult(pageOf(request, 'id'));
export const getCommentCount = (request) => commentCountResult(rawQuery(request, 'id'));
export const getMvList = (request) => mvListResult({
    area: rawQuery(request, 'area'),
    version: rawQuery(request, 'version'),
    offset: rawQuery(request, 'offset'),
    limit: rawQuery(request, 'limit'),
});
export const getMvDetail = (request) => mvDetailResult(rawQuery(request, 'vid'));
export const getMvUrl = async (request) => mvUrlResult(rawQuery(request, 'vid'), await optionalSession(request));
export const getSongMvs = (request) => songMvsResult(rawQuery(request, 'id'));
export const getSongLabels = (request) => songLabelsResult(rawQuery(request, 'id'));
