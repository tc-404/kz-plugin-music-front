import { logger } from '../../util/logger.js';
import { createAndroidDevice, describeDeviceContext } from './androidDevice.js';
export const createMemoryDeviceContextRepository = (seed = null) => {
    let stored = seed ? { ...seed } : null;
    return {
        kind: 'memory',
        load: () => (stored ? { ...stored } : null),
        save: (device) => {
            stored = { ...device };
        },
        clear: () => {
            stored = null;
        },
    };
};
/**
 * Loads the persisted context lazily on first use, so importing the auth service never
 * touches the filesystem, and writes back after each protocol step that mutates it.
 */
export const createDeviceContextStore = (repository) => {
    let device = null;
    const load = () => {
        if (device)
            return device;
        const restored = repository.load();
        device = restored ?? createAndroidDevice();
        logger.info('qq-auth.device-context.ready', {
            kind: repository.kind,
            source: restored ? 'restored' : 'created',
            ...describeDeviceContext(device),
        });
        if (!restored)
            repository.save(device);
        return device;
    };
    return {
        get: load,
        persist: () => {
            if (device)
                repository.save(device);
        },
        reset: () => {
            device = createAndroidDevice();
            repository.save(device);
            logger.info('qq-auth.device-context.ready', {
                kind: repository.kind,
                source: 'reset',
                ...describeDeviceContext(device),
            });
            return device;
        },
    };
};
export default createDeviceContextStore;
