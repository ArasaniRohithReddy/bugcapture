#!/usr/bin/env node
/**
 * BugCapture build.
 *
 * Two passes are required because Vite emits ES modules while MV3 content
 * scripts (and the MAIN-world injected script) must be classic, self-contained
 * IIFE bundles:
 *   1. Vite  -> the React extension pages (popup / options / report / viewer).
 *   2. esbuild -> background service worker, content script, injected script,
 *      offscreen document script.
 *
 * Pass `--watch` for an incremental build suitable for "Load unpacked".
 */
import { build as viteBuild } from 'vite';
import * as esbuild from 'esbuild';
import { rm, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');
const dist = resolve(root, 'dist');

const scriptEntries = {
  background: 'src/background/index.ts',
  content: 'src/content/index.ts',
  rewind: 'src/content/rewind.ts',
  injected: 'src/content/injected.ts',
  offscreen: 'src/offscreen/offscreen.ts',
};

/** @type {import('esbuild').BuildOptions} */
const baseEsbuild = {
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome116',
  logLevel: 'info',
  legalComments: 'none',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
};

async function buildScripts() {
  const jobs = Object.entries(scriptEntries).map(async ([name, entry]) => {
    const options = {
      ...baseEsbuild,
      entryPoints: [resolve(root, entry)],
      outfile: resolve(dist, `assets/${name}.js`),
    };
    if (watch) {
      const ctx = await esbuild.context(options);
      await ctx.watch();
    } else {
      await esbuild.build(options);
    }
  });
  await Promise.all(jobs);
}

async function main() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  await viteBuild({
    configFile: resolve(root, 'vite.config.ts'),
    build: { watch: watch ? {} : null },
    logLevel: 'info',
  });
  await buildScripts();

  if (watch) {
    console.log('\nBugCapture watch build running. Load `dist/` via chrome://extensions.');
  } else {
    console.log('\nBugCapture built to dist/. Load it via chrome://extensions -> Load unpacked.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
