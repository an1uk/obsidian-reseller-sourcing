import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = process.cwd();
const readJson = async file => JSON.parse(await fs.readFile(path.join(root, file), 'utf8'));
const manifest = await readJson('manifest.json');
const pkg = await readJson('package.json');
const metadata = await readJson('dist/release-checksums.json');
const version = manifest.version;
if (!/^\d+\.\d+\.\d+$/.test(version) || pkg.version !== version || metadata.version !== version) throw Error('Release versions differ.');
if (process.env.EXPECTED_VERSION && process.env.EXPECTED_VERSION !== version) throw Error('The exact version tag must match the manifest.');
if (manifest.id !== 'charity-sourcing' || metadata.id !== manifest.id) throw Error('Unexpected plugin identity.');

const output = path.join(root, 'dist/publish');
await fs.mkdir(output, { recursive: true });
const expected = ['main.js', 'manifest.json', 'styles.css', metadata.archive.name, 'release-checksums.json'].sort();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const name of ['main.js', 'manifest.json', 'styles.css']) {
  const bytes = await fs.readFile(path.join(root, 'dist/release', name));
  if (hash(bytes) !== metadata.files[name]) throw Error('Release checksum mismatch: ' + name);
  await fs.writeFile(path.join(output, name), bytes);
}
if (metadata.archive.name !== 'charity-sourcing-' + version + '.zip') throw Error('Unexpected archive name.');
const archive = await fs.readFile(path.join(root, 'dist', metadata.archive.name));
if (hash(archive) !== metadata.archive.sha256) throw Error('Archive checksum mismatch.');
await fs.writeFile(path.join(output, metadata.archive.name), archive);
await fs.copyFile(path.join(root, 'dist/release-checksums.json'), path.join(output, 'release-checksums.json'));
if (JSON.stringify((await fs.readdir(output)).sort()) !== JSON.stringify(expected)) throw Error('Unexpected publish assets; use a clean build directory.');
console.log('Verified five release assets for ' + version + '.');
