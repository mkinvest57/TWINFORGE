import {HttpError} from './budget.mjs';
import {samStatus, segment} from './sam.mjs';

const SECURE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
};
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: {...SECURE_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    ...(body.retry_after_s ? {'Retry-After': String(body.retry_after_s)} : {})},
});

export function createHandler({assets, segmenter = segment, status = samStatus}) {
  return {
    async fetch(request, env, context) {
      // The existing owner-private Sites identity gate is the access boundary.
      // No client-selected identity, public proxy, or cross-origin API is added.
      const url = new URL(request.url), path = url.pathname;
      try {
        if (path === '/api/sam/status' && request.method === 'GET') return json(await status(env));
        if (path === '/api/sam/segment' && request.method === 'POST') {
          const origin = request.headers.get('origin');
          if (origin && origin !== url.origin) throw new HttpError(403, 'Cross-origin observations are not accepted.');
          if (request.headers.get('sec-fetch-site') === 'cross-site') throw new HttpError(403, 'Cross-site observations are not accepted.');
          const observation = segmenter(request, env);
          // A reset, navigation or closed tab can disconnect this request after
          // the provider was paid. Retain the same task until its bounded
          // provider call AND durable settlement finish. Without waitUntil,
          // Workers cancels that work and leaves a global requesting lease.
          context?.waitUntil(observation.catch(() => {}));
          return json(await observation);
        }
        if (path.startsWith('/api/')) return json({error: 'This hosted runtime exposes only the live SAM observation API.'}, 404);
        if (!['GET', 'HEAD'].includes(request.method)) return json({error: 'Method not allowed.'}, 405);
        const resolved = path === '/' ? '/index.html' : path === '/scan' ? '/scan.html' : path === '/workbench' ? '/workbench.html' : path;
        const asset = Object.hasOwn(assets, resolved) ? assets[resolved] : null;
        if (!asset) return new Response('Not found', {status: 404, headers: SECURE_HEADERS});
        const body = request.method === 'HEAD' ? null : Uint8Array.from(atob(asset.base64), c => c.charCodeAt(0));
        return new Response(body, {headers: {...SECURE_HEADERS, 'Content-Type': asset.type,
          'Cache-Control': 'no-cache', ETag: '"' + asset.sha256 + '"'}});
      } catch (error) {
        return json({error: error instanceof HttpError ? error.message : 'The hosted observation service is unavailable.',
          ...(error instanceof HttpError ? error.detail : {})},
          error instanceof HttpError ? error.status : 503);
      }
    },
  };
}
