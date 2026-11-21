import { resolve, dirname } from 'path';
import { defineConfig } from 'vite';
import { builtinModules } from 'module';
import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = 'kz-plugin-music-front';

const nodeModules = [
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
].flat();

/** 日志分级开关：package.json 的 debugLog 键非空 = 调试模式（输出全部日志），空 = 精简模式。
 *  构建时固化为字面量，运行时只读常量、不读磁盘。 */
const pkg = JSON.parse(fs.readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));
const debugLog = typeof pkg.debugLog === 'string' ? pkg.debugLog : '';

/** 构建收尾：把两个 JSON、文档、WebUI 静态页拷进产物夹 */
function copyAssetsPlugin() {
  return {
    name: 'copy-music-front-assets',
    buildStart() {
      // 只清理 vite 自己生成的文件，绝不碰 upstream/（内置服务，74MB，由 prepare-upstream.py 管理）
      const outDir = resolve(__dirname, OUT_DIR);
      if (!fs.existsSync(outDir)) return;
      for (const f of ['index.mjs', 'plugin.json', 'package.json', '插件文档.md']) {
        const p = resolve(outDir, f);
        if (fs.existsSync(p)) fs.rmSync(p, { force: true });
      }
      const webuiDst = resolve(outDir, 'webui');
      if (fs.existsSync(webuiDst)) {
        for (const f of fs.readdirSync(webuiDst)) {
          const p = path.join(webuiDst, f);
          if (fs.statSync(p).isFile()) fs.rmSync(p, { force: true });
        }
      }
    },
    writeBundle() {
      const outDir = resolve(__dirname, OUT_DIR);
      const copy = (from: string, to: string) => {
        const src = resolve(__dirname, from);
        if (fs.existsSync(src)) fs.copyFileSync(src, resolve(outDir, to));
      };
      copy('plugin.json', 'plugin.json');
      copy('插件文档.md', '插件文档.md');

      const pkgPath = resolve(__dirname, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const distPkg = {
          name: pkg.name,
          plugin: pkg.plugin,
          version: pkg.version,
          type: pkg.type,
          main: pkg.main,
          description: pkg.description,
          author: pkg.author,
          license: pkg.license,
        };
        fs.writeFileSync(resolve(outDir, 'package.json'), `${JSON.stringify(distPkg, null, 2)}\n`);
      }

      // 递归拷贝 webui 目录
      const webuiSrc = resolve(__dirname, 'webui');
      const webuiDst = resolve(outDir, 'webui');
      if (fs.existsSync(webuiSrc)) {
        fs.mkdirSync(webuiDst, { recursive: true });
        for (const file of fs.readdirSync(webuiSrc)) {
          const s = path.join(webuiSrc, file);
          if (fs.statSync(s).isFile()) fs.copyFileSync(s, path.join(webuiDst, file));
        }
      }
    },
  };
}

export default defineConfig({
  resolve: { conditions: ['node', 'default'] },
  define: { __DEBUG_LOG__: JSON.stringify(debugLog) },
  build: {
    sourcemap: false,
    target: 'esnext',
    minify: 'esbuild',
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'index.mjs',
    },
    rollupOptions: {
      external: [...nodeModules],
      output: { inlineDynamicImports: true },
    },
    outDir: OUT_DIR,
    // 不清空整个目录：upstream/ 由 prepare-upstream.py 独立管理，避免每次构建触发 74MB 批量删除
    emptyOutDir: false,
  },
  plugins: [copyAssetsPlugin()],
});
