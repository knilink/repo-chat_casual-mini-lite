import { resolve } from 'path';
import { mergeConfig, defineConfig } from 'vite';
import { crx, ManifestV3Export } from '@crxjs/vite-plugin';
import baseConfig, { baseManifest, baseBuildOptions } from './vite.config.base';
import firefoxManifest from './manifest.firefox.json';

const outDir = resolve(__dirname, 'dist_firefox');

export default mergeConfig(
  baseConfig,
  defineConfig({
    plugins: [
      crx({
        manifest: {
          ...baseManifest,
          ...firefoxManifest,
          background: {
            scripts: ['src/pages/background/index.ts'],
          },
          // work around
          side_panel: {
            default_path: 'src/pages/panel/index.html',
          },
        } as ManifestV3Export,
        browser: 'firefox',
        contentScripts: {
          injectCss: true,
        },
      }),
    ],
    build: {
      ...baseBuildOptions,
      outDir,
    },
    publicDir: resolve(__dirname, 'public'),
  })
);
