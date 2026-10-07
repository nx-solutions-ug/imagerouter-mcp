import { chmod, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { $ } from 'bun';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/dashboard', { recursive: true });

const cli = await Bun.build({
  entrypoints: ['src/cli.ts'],
  outdir: 'dist',
  target: 'bun',
  format: 'esm',
  packages: 'external',
});
const ui = await Bun.build({
  entrypoints: ['src/dashboard/ui/app.ts'],
  outdir: 'dist/dashboard',
  target: 'browser',
  minify: true,
});
for (const result of [cli, ui]) {
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
}

const built = await readFile('dist/cli.js', 'utf8');
if (!built.startsWith('#!')) await writeFile('dist/cli.js', `#!/usr/bin/env bun\n${built}`);
await chmod('dist/cli.js', 0o755);

await $`bunx @tailwindcss/cli -i src/dashboard/ui/styles.css -o dist/dashboard/styles.css --minify`.quiet();
await cp('src/dashboard/ui/index.html', 'dist/dashboard/index.html');
console.log('Built dist/cli.js and dist/dashboard/');
