class WebBytes extends Uint8Array {
    slice(start, end) {
        return this.subarray(start, end);
    }
    readUInt16BE(offset = 0) {
        this.checkOffset(offset);
        return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint16(offset);
    }
    writeUInt16BE(value, offset = 0) {
        this.checkOffset(offset);
        if (value < 0 || value > 65535 || !Number.isFinite(value))
            throw new RangeError('Invalid unsigned length');
        new DataView(this.buffer, this.byteOffset, this.byteLength).setUint16(offset, value);
        return offset + 2;
    }
    checkOffset(offset) {
        if (!Number.isInteger(offset) || offset < 0 || offset + 2 > this.length)
            throw new RangeError('Invalid byte offset');
    }
    toString(encoding = 'utf8', start = 0, end = this.length) {
        const bytes = this.subarray(Math.max(0, start), Math.max(0, end));
        if (encoding === 'hex')
            return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
        if (encoding === 'base64' || encoding === 'base64url') {
            let binary = '';
            for (const byte of bytes)
                binary += String.fromCharCode(byte);
            const encoded = btoa(binary);
            return encoding === 'base64url'
                ? encoded.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
                : encoded;
        }
        return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    }
    toJSON() {
        return { type: 'Buffer', data: [...this] };
    }
}
const from = (value, encodingOrOffset, length) => {
    if (typeof value === 'string') {
        if (encodingOrOffset === 'hex') {
            const bytes = [];
            for (let offset = 0; offset + 1 < value.length; offset += 2) {
                const pair = value.slice(offset, offset + 2);
                if (!/^[0-9a-f]{2}$/i.test(pair))
                    break;
                bytes.push(Number.parseInt(pair, 16));
            }
            return new WebBytes(bytes);
        }
        if (encodingOrOffset === 'base64' || encodingOrOffset === 'base64url') {
            let clean = value
                .replaceAll('-', '+')
                .replaceAll('_', '/')
                .replace(/[^A-Za-z0-9+/=]/g, '')
                .split('=')[0];
            if (clean.length % 4 === 1)
                clean = clean.slice(0, -1);
            const decoded = atob(clean + '='.repeat((4 - (clean.length % 4)) % 4));
            return new WebBytes(Array.from(decoded, (char) => char.charCodeAt(0)));
        }
        return new WebBytes(new TextEncoder().encode(value));
    }
    if (value instanceof ArrayBuffer ||
        (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer)) {
        const offset = typeof encodingOrOffset === 'number' ? encodingOrOffset : 0;
        return new WebBytes(value, offset, length ?? value.byteLength - offset);
    }
    return new WebBytes(value);
};
const alloc = (size) => {
    if (!Number.isSafeInteger(size) || size < 0)
        throw new RangeError('Invalid byte length');
    return new WebBytes(size);
};
export const webBuffer = {
    from,
    alloc,
    allocUnsafe: alloc,
    isBuffer: (value) => value instanceof WebBytes,
    byteLength: (value, encoding) => from(value, encoding).length,
    concat: (list, totalLength = list.reduce((sum, bytes) => sum + bytes.length, 0)) => {
        const result = alloc(totalLength);
        let offset = 0;
        for (const bytes of list) {
            const count = Math.min(bytes.length, result.length - offset);
            result.set(bytes.subarray(0, count), offset);
            offset += count;
            if (offset === result.length)
                break;
        }
        return result;
    },
};
export const Buffer = globalThis.Buffer ??
    webBuffer;
