import { cloudSongsResult } from '../../services/user/cloud.js';
export const userCloud = async (request) => cloudSongsResult(await (await request.service()).resolveSession(request.token), {
    limit: request.query('limit'),
    offset: request.query('offset'),
});
