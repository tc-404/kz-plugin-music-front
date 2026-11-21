import { legacyRequestStructureOf } from '../protocol/logStructure.js';
import { logger } from '../util/logger.js';
import { getLegacyHttpTransport } from './httpTransport.js';
export default ({ options = {}, method = 'get' }) => {
    // The registered transport owns both execution and the request defaults. Reading them from
    // `../config` here is what pulled the filesystem-backed config manager into the serverless
    // dependency graph (M0 0.2).
    const transport = getLegacyHttpTransport();
    const { baseURL, commonParams, referer } = transport.defaults;
    const opts = Object.assign({}, options, commonParams, {
        headers: {
            referer: referer.u,
            host: 'u.y.qq.com',
            'content-type': 'application/x-www-form-urlencoded',
            ...options.headers,
        },
    });
    logger.debug('upstream.request-structure', legacyRequestStructureOf(baseURL.u, method, opts));
    return transport.request(baseURL.u, method, opts, 'u');
};
