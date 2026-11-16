# CORS proxy for app-ads.txt

Self-hosted replacement for the free third-party CORS proxies `fetchFromUrl()`
(`src/url.js`) used to depend on — both turned out unreliable in practice
(allorigins.win: largely down; corsfix.com: requires registering this site's
domain). Running it on the repo owner's own Cloudflare account removes that
dependency on someone else's uptime.

Deploy (one-time, then redeploy only if `worker.js` changes):

```bash
cd cors-proxy
npx wrangler login      # opens a browser to authorize with your Cloudflare account
npx wrangler deploy
```

`wrangler deploy` prints the worker's URL (`https://app-ads-cors-proxy.<your-subdomain>.workers.dev`).
Put that URL into `CORS_PROXIES` in `../src/url.js`.

The worker only fetches URLs whose path ends in `/app-ads.txt`, so it can't be
repurposed as a general open proxy.
