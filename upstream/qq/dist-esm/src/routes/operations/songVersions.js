import { songVersionsResult } from '../../services/song/versions.js';
export const songVersions = (request) => songVersionsResult({ id: request.query('id'), mid: request.query('mid') });
