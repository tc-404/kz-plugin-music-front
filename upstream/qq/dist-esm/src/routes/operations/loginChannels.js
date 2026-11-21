import { NODE_RUNTIME_CAPABILITIES } from '../../services/auth/qrLogin.js';
import { describeRuntimeCapabilities } from '../../services/runtimeCapabilities.js';
export const loginChannels = async (request) => {
    const node = request.runtime === 'node';
    const capabilities = node
        ? NODE_RUNTIME_CAPABILITIES
        : (request.capabilities ?? { channels: ['wechat'], sessionMode: 'sealed' });
    return {
        status: 200,
        headers: {},
        body: {
            code: 200,
            data: describeRuntimeCapabilities(request.runtime, capabilities, node || Boolean(request.sessionConfigured)),
        },
    };
};
