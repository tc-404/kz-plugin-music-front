import { legacyRequestStructureOf } from '../protocol/logStructure.js';
import { logger } from '../util/logger.js';
import { getLegacyHttpTransport } from './httpTransport.js';
export default ({ url, method = 'get', options = {}, hasCommonParams = true, }) => {
    // See `u_common.ts`: defaults come from the registered transport, never from `../config`.
    const transport = getLegacyHttpTransport();
    const commonParams = hasCommonParams ? transport.defaults.commonParams : {};
    const opts = Object.assign({}, options, commonParams, {
        headers: {
            referer: transport.defaults.referer.c,
            host: 'c.y.qq.com',
            ...options.headers,
        },
    });
    logger.debug('upstream.request-structure', legacyRequestStructureOf(url, method, opts));
    return transport.request(url, method, opts);
};
