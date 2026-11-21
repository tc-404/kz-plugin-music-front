// src/transport/httpClientTypes.ts
//
// 登录服务与旧路由共用的 HTTP 客户端接口，只有类型。Node 用 axios 实现，serverless 用 fetch 实现；
// 这里只写两边都会用到的那几项，不依赖 axios，serverless 打包时整个文件会被擦掉。
export {};
