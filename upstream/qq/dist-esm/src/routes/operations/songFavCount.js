import { songFavCountResult } from '../../services/song/favCount.js';
export const songFavCount = (request) => songFavCountResult(request.query('ids'));
