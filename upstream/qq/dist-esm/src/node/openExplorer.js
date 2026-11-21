import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { API_EXPLORER_ROUTE_PATH } from '../config/apiExplorer.js';
import { logger, loggerState } from '../util/logger.js';
export const AUTO_OPEN_EXPLORER_ENV = 'AUTO_OPEN_EXPLORER';
const sanitizeSessionId = (value) => value.replace(/[^A-Za-z0-9_-]/g, '_');
export const shouldAutoOpenExplorer = () => {
    if (loggerState.isTestEnv) {
        return false;
    }
    if (process.env.CI) {
        return false;
    }
    return process.env[AUTO_OPEN_EXPLORER_ENV] === 'true';
};
export const getExplorerUrl = (port) => `http://localhost:${port}${API_EXPLORER_ROUTE_PATH}`;
export const getExplorerSessionMarkerPath = (port) => path.join(os.tmpdir(), `qq-music-api-explorer-${sanitizeSessionId(String(process.ppid || process.pid))}-${port}.lock`);
export const getOpenCommand = (url) => {
    switch (process.platform) {
        case 'darwin':
            return { command: 'open', args: [url] };
        case 'win32':
            return { command: 'cmd', args: ['/c', 'start', '', url] };
        default:
            return { command: 'xdg-open', args: [url] };
    }
};
export const autoOpenExplorer = (port) => {
    if (!shouldAutoOpenExplorer()) {
        return;
    }
    const explorerUrl = getExplorerUrl(port);
    const markerPath = getExplorerSessionMarkerPath(port);
    if (existsSync(markerPath)) {
        return;
    }
    try {
        writeFileSync(markerPath, explorerUrl, 'utf8');
    }
    catch (error) {
        logger.warn('explorer.auto_open_marker_failed', {
            markerPath,
            error: error instanceof Error ? error.message : String(error),
        });
    }
    try {
        const { command, args } = getOpenCommand(explorerUrl);
        const childProcess = spawn(command, args, {
            detached: true,
            stdio: 'ignore',
        });
        childProcess.on('error', (error) => {
            logger.warn('explorer.auto_open_failed', {
                url: explorerUrl,
                error: error.message,
            });
        });
        childProcess.unref();
        logger.info('explorer.auto_open_started', {
            url: explorerUrl,
        });
    }
    catch (error) {
        logger.warn('explorer.auto_open_failed', {
            url: explorerUrl,
            error: error instanceof Error ? error.message : String(error),
        });
    }
};
