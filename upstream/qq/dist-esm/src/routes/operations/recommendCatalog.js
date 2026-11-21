import { categoryPlaylistsResult, newAlbumsResult, newSongsResult, playlistCategoriesResult, toplistSongsResult, toplistsResult, } from '../../services/recommend/catalog.js';
import { rawQuery } from './requestValues.js';
// src/routes/operations/recommendCatalog.ts
//
// 歌单分类、分类歌单、新歌、新碟、排行榜：公开内容，一律匿名读，没设会话密钥也能用。
export const getPlaylistCategories = () => playlistCategoriesResult();
export const getCategoryPlaylists = (request) => categoryPlaylistsResult({
    id: rawQuery(request, 'id'),
    page: rawQuery(request, 'page'),
    limit: rawQuery(request, 'limit'),
});
export const getNewSongs = (request) => newSongsResult(rawQuery(request, 'area'));
export const getNewAlbums = (request) => newAlbumsResult({
    area: rawQuery(request, 'area'),
    offset: rawQuery(request, 'offset'),
    limit: rawQuery(request, 'limit'),
});
export const getRecommendToplists = () => toplistsResult();
export const getRecommendToplistSongs = (request) => toplistSongsResult({
    id: rawQuery(request, 'id'),
    period: rawQuery(request, 'period'),
    offset: rawQuery(request, 'offset'),
    limit: rawQuery(request, 'limit'),
});
