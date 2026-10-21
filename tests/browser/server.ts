import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, packageKeys } from '../../src/config.ts';
import { createConsumer } from '../helpers/consumer.ts';

// Every synchronous browser module comes from npm pack + npm install.
const consumer = createConsumer();
const reference = createConsumer('upstream');

// URL-to-file allowlist; request paths are never resolved directly against the filesystem.
const routes = new Map<string, string>();

for (const key of packageKeys) {
  for (const extension of [
    'mjs',
    'esm.js',
    'browser.mjs',
    'browser.min.mjs',
    'umd.js',
    'umd.min.js',
  ]) {
    routes.set(
      '/synchronous/' + key + '.' + extension,
      join(consumer.packageDirectory(key), 'dist', 'floating-ui.' + key + '.' + extension),
    );
    routes.set(
      '/upstream/' + key + '.' + extension,
      join(reference.packageDirectory(key), 'dist', 'floating-ui.' + key + '.' + extension),
    );
  }
}

// Scopes resolve each package's own utils selection, even when core and DOM use different versions.
const imports = {
  [config.core.name]: '/synchronous/core.mjs',
  [config.dom.name]: '/synchronous/dom.mjs',
  '@floating-ui/core': '/upstream/core.mjs',
};
const scopes: Record<string, Record<string, string>> = {};

for (const [variant, installation] of [
  ['synchronous', consumer],
  ['upstream', reference],
] as const) {
  for (const key of packageKeys) {
    const prefix = '/' + variant + '/' + key;
    const utils = installation.dependencyDirectory(key, '@floating-ui/utils');

    routes.set(prefix + '-utils.mjs', join(utils, 'dist/floating-ui.utils.mjs'));
    routes.set(prefix + '-utils-dom.mjs', join(utils, 'dist/floating-ui.utils.dom.mjs'));

    scopes[prefix + '.mjs'] = {
      '@floating-ui/utils': prefix + '-utils.mjs',
      '@floating-ui/utils/dom': prefix + '-utils-dom.mjs',
    };
    scopes[prefix + '.esm.js'] = scopes[prefix + '.mjs'];
  }
}

const html =
  '<!doctype html><html><head><meta charset="UTF-8"><script type="importmap">' +
  JSON.stringify({ imports, scopes }) +
  '</script></head><body></body></html>';

createServer((request, response) => {
  if (request.url === '/') {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(html);
  } else {
    const path = routes.get(request.url ?? '');

    if (!path) {
      response.writeHead(404);
      response.end();
      return;
    }

    response.writeHead(200, { 'content-type': 'text/javascript' });
    response.end(readFileSync(path));
  }
}).listen(4178, '127.0.0.1');
