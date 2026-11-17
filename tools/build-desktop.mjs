#!/usr/bin/env node
// Builds the portable desktop launcher:  npm run desktop  →  release/OpenGalaxy.exe
//
// Steps: web build → copy dist/ into desktop/web (embedded by Go) → generate icon PNGs →
// Windows resources (icon, version info, manifest) via go-winres → go build.
// Requires the Go toolchain (https://go.dev/dl/), only for building.

import { execFileSync, execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const desktop = join(root, 'desktop');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const GO_WINRES = 'github.com/tc-hib/go-winres@v0.3.3';

function findGo() {
  const candidates = [
    process.env.GO,
    process.env.GOROOT && join(process.env.GOROOT, 'bin', process.platform === 'win32' ? 'go.exe' : 'go'),
    process.platform === 'win32' ? 'C:\\Program Files\\Go\\bin\\go.exe' : '/usr/local/go/bin/go',
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  return 'go'; // hope it's on PATH
}

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });
const go = findGo();

console.log('› Building the web app');
execSync('npm run build', { stdio: 'inherit' }); // via the shell: npm is a .cmd script on Windows

console.log('› Embedding dist/ into the launcher');
rmSync(join(desktop, 'web'), { recursive: true, force: true });
cpSync(join(root, 'dist'), join(desktop, 'web'), { recursive: true });

if (process.platform === 'win32' || process.env.GOOS === 'windows') {
  console.log('› Icon and version resources');
  const winres = join(desktop, 'winres');
  mkdirSync(winres, { recursive: true });
  run(go, ['run', './cmd/genicon', 'winres'], { cwd: desktop });
  const v = `${version.split('-')[0]}.0`; // 0.2.0 → 0.2.0.0
  writeFileSync(
    join(winres, 'winres.json'),
    JSON.stringify(
      {
        RT_GROUP_ICON: {
          APP: { '0000': ['icon256.png', 'icon64.png', 'icon48.png', 'icon32.png', 'icon24.png', 'icon16.png'] },
        },
        RT_MANIFEST: {
          '#1': {
            '0409': {
              identity: { name: 'OpenGalaxy', version: v },
              description: 'OpenGalaxy keyboard lighting',
              'minimum-os': 'win10',
              'execution-level': 'as invoker',
              'dpi-awareness': 'per monitor v2',
            },
          },
        },
        RT_VERSION: {
          '#1': {
            '0000': {
              fixed: { file_version: v, product_version: v },
              info: {
                '0409': {
                  FileDescription: 'OpenGalaxy – Galaxy80 lighting studio',
                  ProductName: 'OpenGalaxy',
                  ProductVersion: version,
                  FileVersion: version,
                  OriginalFilename: 'OpenGalaxy.exe',
                  LegalCopyright: 'MIT License. Not affiliated with Epomaker.',
                },
              },
            },
          },
        },
      },
      null,
      2,
    ),
  );
  run(go, ['run', GO_WINRES, 'make', '--in', 'winres/winres.json', '--out', 'rsrc'], { cwd: desktop });
}

console.log('› Compiling');
mkdirSync(join(root, 'release'), { recursive: true });
const exe = join(root, 'release', process.platform === 'win32' ? 'OpenGalaxy.exe' : 'OpenGalaxy');
// Build id = package version + UTC timestamp, so a running older build can be told apart.
const buildId = `${version}+${new Date().toISOString().replace(/[-:]/g, '').slice(0, 13)}`;
const ldflags = [`-s -w -X main.version=${buildId}`, process.platform === 'win32' ? '-H=windowsgui' : '']
  .filter(Boolean)
  .join(' ');
run(go, ['build', '-trimpath', `-ldflags=${ldflags}`, '-o', exe, '.'], { cwd: desktop, env: { ...process.env, CGO_ENABLED: '0' } });

console.log(`✓ ${exe.replace(root + (process.platform === 'win32' ? '\\' : '/'), '')} (${(statSync(exe).size / 1024 / 1024).toFixed(1)} MB)`);
