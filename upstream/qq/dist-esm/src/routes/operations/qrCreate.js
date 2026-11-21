import { qrServiceErrorResult } from './qrServiceError.js';
export const qrCreate = async (request) => {
    const key = request.queryRaw('key');
    if (!key)
        return { status: 400, headers: {}, body: { code: 400, message: 'key is required' } };
    try {
        const qrimg = request.qr?.createQr
            ? await request.qr.createQr(String(key))
            : await (await request.service()).createQr(String(key));
        return { status: 200, headers: {}, body: { code: 200, data: { qrimg } } };
    }
    catch (error) {
        return qrServiceErrorResult(error);
    }
};
