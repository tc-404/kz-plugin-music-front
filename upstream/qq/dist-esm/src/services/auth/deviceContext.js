import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../../util/logger.js';
import { isAndroidDevice } from './androidDevice.js';
import { createMemoryDeviceContextRepository, } from './deviceContextStore.js';
// Persistence for the Android device context used by the native QR login protocol.
// The QIMEI bootstrap and every musicu.fcg call must run on ONE stable identity, so the
// context has to survive a process restart instead of being regenerated on every boot.
//
// This module is the filesystem half of the device seam and is Node-only. The device material
// itself lives in `androidDevice.ts`, which stays runtime-neutral so a serverless runtime can
// derive an identity without ever reaching `node:fs`.
export { createAndroidDevice, describeDeviceContext, isAndroidDevice, } from './androidDevice.js';
// The runtime-neutral half now lives in `./deviceContextStore`; re-exported so every existing
// importer of this module keeps working unchanged.
export { createDeviceContextStore, createMemoryDeviceContextRepository, } from './deviceContextStore.js';
export const DEVICE_STATE_ENV = 'QQ_AUTH_STATE_PATH';
export const MEMORY_STATE_PATH = 'memory';
const DEFAULT_STATE_PATH = path.join('.auth-state', 'qq-device.json');
const STATE_FILE_MODE = 0o600;
const STATE_VERSION = 1;
/**
 * Persists the device context as owner-only JSON. Every filesystem failure degrades to an
 * in-process context instead of blocking login: a read-only container still works, it just
 * re-registers a device on the next restart.
 */
export const createFileDeviceContextRepository = (filePath) => ({
    kind: 'file',
    load: () => {
        try {
            if (!fs.existsSync(filePath))
                return null;
            const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            const record = typeof parsed === 'object' && parsed !== null ? parsed : {};
            const device = record.device;
            if (!isAndroidDevice(device)) {
                logger.warn('qq-auth.device-context.invalid-state', { kind: 'file' });
                return null;
            }
            return device;
        }
        catch (error) {
            logger.warn('qq-auth.device-context.load-failed', {
                name: error instanceof Error ? error.name : 'Error',
            });
            return null;
        }
    },
    save: (device) => {
        try {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, `${JSON.stringify({ version: STATE_VERSION, device }, null, 2)}\n`, {
                encoding: 'utf8',
                mode: STATE_FILE_MODE,
            });
        }
        catch (error) {
            logger.warn('qq-auth.device-context.save-failed', {
                name: error instanceof Error ? error.name : 'Error',
            });
        }
    },
    clear: () => {
        try {
            fs.rmSync(filePath, { force: true });
        }
        catch (error) {
            logger.warn('qq-auth.device-context.clear-failed', {
                name: error instanceof Error ? error.name : 'Error',
            });
        }
    },
});
export const resolveDeviceStatePath = (env = process.env) => {
    const configured = env[DEVICE_STATE_ENV]?.trim();
    if (configured === MEMORY_STATE_PATH)
        return null;
    if (configured)
        return path.resolve(configured);
    return path.resolve(process.cwd(), DEFAULT_STATE_PATH);
};
export const createDefaultDeviceContextRepository = (env = process.env) => {
    const statePath = resolveDeviceStatePath(env);
    return statePath
        ? createFileDeviceContextRepository(statePath)
        : createMemoryDeviceContextRepository();
};
export { default } from './deviceContextStore.js';
