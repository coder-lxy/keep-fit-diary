import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// 默认使用相对路径，兼容根目录及子目录托管；GitHub Pages 可通过 VITE_BASE 指定仓库路径。
const base = process.env.VITE_BASE ?? './';

export default defineConfig({
  base,
  build: {
    // 部分静态托管（如 devfile.cn）限制文件数，把依赖里的动态 import 内联进主包，不再拆小 chunk。
    rolldownOptions: {
      output: { codeSplitting: false },
    },
    chunkSizeWarningLimit: 2000,
  },
  server: {
    // 仅开发时有效：智谱接口不允许浏览器跨域调用，由 Vite 开发服务器代为转发。
    // 「数据与设置」里的服务地址填 /ai-proxy/zhipu
    proxy: {
      '/ai-proxy/zhipu': {
        target: 'https://open.bigmodel.cn',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ai-proxy\/zhipu/, '/api/anthropic'),
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: '减脂日记',
        short_name: '减脂日记',
        description: '自用的饮食与运动打卡记录',
        lang: 'zh-CN',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#f6f5f1',
        theme_color: '#2f7d5a',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: `${base}index.html`,
        // workbox 运行时直接写进 sw.js，少一个文件
        inlineWorkboxRuntime: true,
      },
    }),
  ],
});
