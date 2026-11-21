import { QrLoginServiceError } from '../../services/auth/qrLogin.js';
// 只处理原控制器捕获的服务错误；其他异常仍交给宿主的安全兜底。
export const qrServiceErrorResult = (error) => {
    if (!(error instanceof QrLoginServiceError))
        throw error;
    return {
        status: error.httpStatus,
        headers: error.retryAfterMs
            ? { 'retry-after': String(Math.ceil(error.retryAfterMs / 1000)) }
            : {},
        body: {
            code: error.httpStatus,
            message: error.message,
            retryAfterMs: error.retryAfterMs,
            ...(error.upstreamCode === undefined ? {} : { upstreamCode: error.upstreamCode }),
            ...error.diagnostics,
        },
    };
};
