import * as fs from 'node:fs';
import * as https from 'node:https';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequestHandler } from '@react-router/express';
import express from 'express';

const dirname = path.dirname(fileURLToPath(import.meta.url));

const certPath = path.join(dirname, '../certs/localhost-cert.pem');
const keyPath = path.join(dirname, '../certs/localhost-key.pem');

const certificateExists = fs.existsSync(certPath) && fs.existsSync(keyPath);
const useHttps = process.argv.includes('--https');

const setupHttps = certificateExists && useHttps;

const viteDevServer =
  process.env.NODE_ENV === 'production'
    ? null
    : await import('vite').then((vite) =>
        vite.createServer({
          server: {
            middlewareMode: true,
            https: useHttps
              ? {
                  key: fs.readFileSync(keyPath),
                  cert: fs.readFileSync(certPath),
                }
              : undefined,
          },
        }),
      );

const build =
  process.env.NODE_ENV !== 'production' && viteDevServer
    ? () => viteDevServer.ssrLoadModule('virtual:react-router/server-build')
    : await import(path.join(dirname, 'server/index.js'));

const app = express();

app.use(
  process.env.NODE_ENV !== 'production' && viteDevServer
    ? viteDevServer.middlewares
    : express.static('build/client'),
);

app.all('/{*splat}', createRequestHandler({ build }));

if (setupHttps) {
  const httpsOptions = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };

  const hostname = os.hostname();

  const networkInterfaces = os.networkInterfaces();
  const localIP = Object.values(networkInterfaces)
    .flat()
    .find((iface) => iface?.family === 'IPv4' && !iface.internal)?.address;

  const httpsApp = https.createServer(httpsOptions, app);

  httpsApp.listen(3000, () => {
    console.log('App listening on https://localhost:3000');
    console.log(`Also available at https://${hostname}:3000`);
    if (localIP) {
      console.log(`Also available at https://${localIP}:3000`);
    }
  });
} else {
  if (useHttps && !certificateExists) {
    console.warn('HTTPS certificates not found. Falling back to HTTP.');
  }
  app.listen(3000, () => {
    console.log('App listening on http://localhost:3000');
  });
}
