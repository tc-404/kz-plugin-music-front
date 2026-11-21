/** The channels whose QR is created by `CreateQRCode` and answered over MQTT. */
export const isMqttLoginChannel = (channel) => channel === 'qq' || channel === 'qqmusic';
export const DEFAULT_LOGIN_CHANNEL = 'qq';
export const NODE_RUNTIME_CAPABILITIES = {
    // `qqmusic` goes last: a client that lists channels in order keeps showing the existing two first.
    channels: ['qq', 'wechat', 'qqmusic'],
    sessionMode: 'stored',
};
/** The channels the Node entry point routes; unchanged, now derived from its capabilities. */
export const SUPPORTED_LOGIN_CHANNELS = NODE_RUNTIME_CAPABILITIES.channels;
export const isSupportedLoginChannel = (value) => SUPPORTED_LOGIN_CHANNELS.includes(value);
export const LEGACY_LOGIN_CHANNEL_ALIASES = new Map([['mobile', 'qq']]);
/** Accepts a canonical channel or a legacy alias and answers with the canonical value. */
export const normalizeLoginChannel = (value) => {
    if (isSupportedLoginChannel(value))
        return value;
    return typeof value === 'string' ? LEGACY_LOGIN_CHANNEL_ALIASES.get(value) : undefined;
};
