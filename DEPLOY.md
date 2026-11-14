# Self-hosting OpenGalaxy

OpenGalaxy is a static website: HTML, JS, CSS and fonts. It has no backend, no database and no
external requests. Settings live in each browser's `localStorage`. Any web server can host it.

## 1. Build the package

```bash
npm install
npm run export
```

This creates `release/opengalaxy-<version>.zip`. Inside it, the `opengalaxy/` folder is the whole
site. (`npm run build` alone produces the same files in `dist/`.)

Paths are relative, so the folder works at the web root (`https://galaxy.lan/`) or in a
subfolder (`https://server.lan/tools/opengalaxy/`).

## 2. ⚠ HTTPS is required

Browsers only allow keyboard access (WebHID) on **secure origins**: `https://…` or
`http://localhost`. Over `http://192.168.x.x` the app still loads, but it shows a warning and only
demo mode works.

Options for a private server:

| Setup | HTTPS via |
| --- | --- |
| Public domain | Let's Encrypt (Caddy does this automatically) |
| LAN only | Caddy `tls internal` + trust its root certificate on your PC once |
| LAN only, existing proxy | Your proxy's certificate (Traefik, Nginx Proxy Manager, …) |
| Reachable via Tailscale | `tailscale serve` / `tailscale cert` gives a valid HTTPS name |

## 3. Server examples (in `deploy/`)

- **Caddy** (simplest, automatic HTTPS): [`deploy/Caddyfile`](deploy/Caddyfile)
- **nginx**: [`deploy/nginx.conf`](deploy/nginx.conf)
- **Docker** (nginx image, HTTP behind your HTTPS reverse proxy):

  ```bash
  npm run build
  docker build -f deploy/Dockerfile -t opengalaxy .
  docker run -d --name opengalaxy -p 8080:80 --restart unless-stopped opengalaxy
  ```

Any other static host works too (Apache, a NAS web station, …). Just serve the files.

### Recommended headers

The examples already set these. If you add your own policy, keep `hid=(self)` allowed:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'
Permissions-Policy: hid=(self)
```

`style-src 'unsafe-inline'` is needed because the app sets colours as inline styles.
A `Permissions-Policy` without `hid=(self)` blocks keyboard access.

## 4. Use it

Open the site in **Chrome or Edge** on the PC the keyboard is plugged into, click
**Connect keyboard** and pick the Galaxy80. The browser remembers the permission per site, so
later visits reconnect automatically. Each browser/device keeps its own settings and presets.

## Updating

Run `npm run export` again and replace the files on the server. The asset file names contain a
content hash, so browsers pick up the new version on the next reload.
