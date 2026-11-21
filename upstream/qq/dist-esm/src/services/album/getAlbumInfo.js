import { logServiceFailure, logServiceRequest, logServiceSuccess } from '../../util/observability.js';
import { toLegacyErrorBody } from '../../util/safeError.js';
import y_common from '../y_common.js';
const upstream = '/v8/fcg-bin/fcg_v8_album_info_cp.fcg';
export default ({ method = 'get', params = {}, options = {}, }) => {
    const data = Object.assign(params, {
        format: 'json',
        outCharset: 'utf-8',
    });
    const opts = Object.assign(options, {
        params: data,
    });
    logServiceRequest('getAlbumInfo', upstream, data);
    return y_common({
        url: upstream,
        method,
        options: opts,
    })
        .then((res) => {
        const response = res.data;
        logServiceSuccess('getAlbumInfo', upstream, response);
        return {
            status: 200,
            body: {
                response,
            },
        };
    })
        .catch((error) => {
        logServiceFailure('getAlbumInfo', upstream, error, data);
        return {
            status: 500,
            body: {
                error: toLegacyErrorBody(error),
            },
        };
    });
};
