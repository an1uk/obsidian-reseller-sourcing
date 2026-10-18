import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { collectLegalNotices } from './legal-notices.mjs';

const sha256 = data => createHash('sha256').update(data).digest('hex');
const releaseNames = ['main.js', 'manifest.json', 'styles.css'];

export async function packagePlugin(root, outputRoot = path.join(root, 'dist')) {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));
  const versions = JSON.parse(await fs.readFile(path.join(root, 'versions.json'), 'utf8'));
  if (manifest.id !== 'charity-sourcing' || manifest.version !== pkg.version || pkg.version !== lock.version || pkg.version !== lock.packages?.['']?.version) throw Error('Package manifest/version mismatch.');
  if (manifest.isDesktopOnly !== false || manifest.minAppVersion !== '1.14.4' || versions[manifest.version] !== manifest.minAppVersion) throw Error('Universal platform/version metadata mismatch.');
  const notices = await collectLegalNotices(root);
  const files = new Map();
  for (const name of [...releaseNames, 'README.md', 'VALIDATION.md']) {
    files.set(name, await fs.readFile(path.join(root, name)));
  }
  for (const [name, data] of notices.files) files.set(name, data);
  files.set('package-checksums.json', Buffer.from(JSON.stringify({ id: manifest.id, version: manifest.version, files: Object.fromEntries([...files].sort().map(([name, data]) => [name, sha256(data)])) }, null, 2) + '\n'));

  const target = path.join(outputRoot, manifest.id);
  for (const [name, data] of files) {
    const filename = path.join(target, name);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, data);
  }

  // A self-contained ZIP writer keeps packaging independent of system archive tools.
  const chunks = [], directory = []; let offset = 0;
  for (const [relative, data] of [...files].sort()) {
    const name = Buffer.from(manifest.id + '/' + relative);
    const compressed = deflateRawSync(data), crc = crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8); local.writeUInt16LE(33, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(8, 10); central.writeUInt16LE(33, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    chunks.push(local, name, compressed); directory.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const dir = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.size, 8); end.writeUInt16LE(files.size, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  const zip = path.join(outputRoot, manifest.id + '-' + manifest.version + '.zip');
  await fs.writeFile(zip, Buffer.concat([...chunks, dir, end]));

  // Community Plugins installs these exact three files, on either platform.
  const release = path.join(outputRoot, 'release');
  await fs.mkdir(release, { recursive: true });
  const releaseChecksums = {};
  for (const name of releaseNames) {
    const data = files.get(name), filename = path.join(release, name);
    await fs.writeFile(filename, data);
    const written = await fs.readFile(filename);
    if (!written.equals(data)) throw Error('Release asset differs after writing: ' + name);
    releaseChecksums[name] = sha256(written);
  }
  const metadata = {
    id: manifest.id, version: manifest.version, minAppVersion: manifest.minAppVersion,
    isDesktopOnly: manifest.isDesktopOnly, files: releaseChecksums,
    archive: { name: path.basename(zip), sha256: sha256(await fs.readFile(zip)) },
    thirdPartyNotices: { sha256: sha256(notices.text), dependencies: notices.dependencies.length }
  };
  await fs.writeFile(path.join(outputRoot, 'release-checksums.json'), JSON.stringify(metadata, null, 2) + '\n');
  return { files: files.size, dependencies: notices.dependencies.length, zip, release, metadata };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = await packagePlugin(root);
  console.log('Packaged ' + result.files + ' files with ' + result.dependencies + ' dependency notices: ' + result.zip);
  console.log('Shared desktop/Android release assets: ' + result.release);
}
