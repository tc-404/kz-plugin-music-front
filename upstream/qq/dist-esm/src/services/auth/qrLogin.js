// src/services/auth/qrLogin.ts
// 保留原来的认证入口与公开名称；实现分别放在协议、会话、播放和 QR 服务模块中。
export { buildAndroidComm, buildQimeiRequest } from './androidDevice.js';
export { createMqttListen, createMqttListenOver, webSocketConnect, } from './mqtt.js';
export { credentialCookieHeader, QqDeviceBootstrapError, QqProtocolError, QrLoginServiceError, } from './musicuProtocol.js';
export { createRelayQqQrDriver } from './qrDrivers.js';
export { createQrLoginService } from './qrService.js';
export { DEFAULT_LOGIN_CHANNEL, isSupportedLoginChannel, NODE_RUNTIME_CAPABILITIES, normalizeLoginChannel, SUPPORTED_LOGIN_CHANNELS, } from './qrTypes.js';
export { createMemoryAuthSessionRepository, createMemoryQrSessionRepository, createStoredSessionResolver, isAuthSession, isQrSessionRecord, } from './sessionState.js';
