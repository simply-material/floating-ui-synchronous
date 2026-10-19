import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config, packageKeys, root } from '../../src/config.ts';
import { createConsumer } from '../helpers/consumer.ts';

// Every synchronous browser module comes from npm pack + npm install.
const consumer = createConsumer();

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
      join(
        root,
        'node_modules',
        '@floating-ui',
        key,
        'dist',
        'floating-ui.' + key + '.' + extension,
      ),
    );
  }
}

// Installed, pinned utils package shared by upstream and transformed browser ESM imports.
const utils = dirname(consumer.require.resolve('@floating-ui/utils/package.json'));
routes.set('/utils.mjs', join(utils, 'dist/floating-ui.utils.mjs'));
routes.set('/utils-dom.mjs', join(utils, 'dist/floating-ui.utils.dom.mjs'));

// Import-map entries keep each DOM variant connected to its own core implementation.
const imports = {
  [config.core.name]: '/synchronous/core.mjs',
  [config.dom.name]: '/synchronous/dom.mjs',
  '@floating-ui/core': '/upstream/core.mjs',
  '@floating-ui/utils': '/utils.mjs',
  '@floating-ui/utils/dom': '/utils-dom.mjs',
};

const html =
  '<!doctype html><html><head><meta charset="UTF-8"><script type="importmap">' +
  JSON.stringify({ imports }) +
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
