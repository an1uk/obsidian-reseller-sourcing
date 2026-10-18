import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageModule = pathToFileURL(path.join(project, 'scripts/package.mjs')).href;
const legalModule = pathToFileURL(path.join(project, 'scripts/legal-notices.mjs')).href;
const { packagePlugin } = await import(packageModule);
const { collectLegalNotices } = await import(legalModule);
const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

async function fixture(t: any): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reseller-universal-package-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const files: Record<string, unknown> = {
    'package.json': { name: 'charity-sourcing', version: '0.5.0', dependencies: { 'runtime-library': '1.0.0' } },
    'package-lock.json': { version: '0.5.0', packages: { '': { version: '0.5.0' } } },
    'manifest.json': { id: 'charity-sourcing', version: '0.5.0', minAppVersion: '1.14.4', isDesktopOnly: false },
    'versions.json': { '0.5.0': '1.14.4' },
    'main.js': 'module.exports = "same desktop and Android build";\n',
    'styles.css': '.source-control { padding: 1em; }\n',
    'README.md': 'Universal installation instructions.\n',
    'VALIDATION.md': 'Physical Android acceptance is outstanding.\n',
    'LICENSE': 'Plugin MIT notice\n',
    'THIRD-PARTY-NOTICES.md': 'Obsidian Maps acknowledgement and map data attribution.\n',
    'licenses/obsidian-maps-MIT.txt': 'Obsidian Maps complete permission and disclaimer\n',
    'node_modules/runtime-library/package.json': { name: 'runtime-library', version: '1.0.0', license: 'MIT' },
    'node_modules/runtime-library/LICENSE': 'Runtime library complete MIT permission and disclaimer\n',
    'node_modules/yaml/package.json': { name: 'yaml', version: '2.9.1', license: 'ISC' },
    'node_modules/yaml/README.md': 'YAML complete ISC licence in README\n'
  };
  for (const [name, data] of Object.entries(files)) {
    const filename = path.join(root, name);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, typeof data === 'string' ? data : JSON.stringify(data));
  }
  return root;
}

function zipEntries(bytes: Buffer): Map<string, Buffer> {
  const result = new Map<string, Buffer>();
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(bytes.readUInt16LE(offset + 8), 8);
    const compressedSize = bytes.readUInt32LE(offset + 18);
    const plainSize = bytes.readUInt32LE(offset + 22);
    const nameSize = bytes.readUInt16LE(offset + 26), extraSize = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameSize).toString('utf8');
    const start = offset + 30 + nameSize + extraSize;
    const data = inflateRawSync(bytes.subarray(start, start + compressedSize));
    assert.equal(data.length, plainSize);
    assert.ok(!result.has(name));
    result.set(name, data);
    offset = start + compressedSize;
  }
  assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
  return result;
}

test('combined credits embed complete installed notices without runtime files or Node imports', async () => {
  const notices = await collectLegalNotices(project);
  assert.equal(notices.dependencies.length, 27);
  for (const [name, data] of notices.files) {
    assert.ok(notices.text.includes(name), name);
    assert.ok(notices.text.includes(data.toString('utf8')), name);
  }
  assert.match(notices.text, /Obsidian Maps 0\.2\.2/);
  assert.match(notices.text, /8703e98013fa20fb188746d24664452f41b17227/);
  const bundle = await build({
    entryPoints: [path.join(project, 'src/credits.ts')], bundle: true, write: false,
    platform: 'browser', format: 'cjs', target: 'es2022',
    define: { __THIRD_PARTY_NOTICES__: JSON.stringify(notices.text) }
  });
  const context = { module: { exports: {} as { THIRD_PARTY_NOTICES: string } } };
  vm.runInNewContext(bundle.outputFiles![0].text, context);
  assert.equal(context.module.exports.THIRD_PARTY_NOTICES, notices.text);
});

test('universal ZIP and three Community Plugins assets have identical payloads and verified metadata', async t => {
  const root = await fixture(t);
  const result = await packagePlugin(root);
  assert.equal(result.dependencies, 2);
  assert.deepEqual((await fs.readdir(result.release)).sort(), ['main.js', 'manifest.json', 'styles.css']);
  const archive = await fs.readFile(result.zip), entries = zipEntries(archive);
  for (const name of ['main.js', 'manifest.json', 'styles.css']) {
    const data = await fs.readFile(path.join(result.release, name));
    assert.deepEqual(data, entries.get('charity-sourcing/' + name), name);
    assert.equal(result.metadata.files[name], sha256(data));
  }
  const checksums = JSON.parse(entries.get('charity-sourcing/package-checksums.json')!.toString('utf8'));
  for (const [name, hash] of Object.entries(checksums.files)) {
    assert.equal(sha256(entries.get('charity-sourcing/' + name)!), hash, name);
  }
  const releaseReceipt = JSON.parse(await fs.readFile(path.join(root, 'dist/release-checksums.json'), 'utf8'));
  assert.equal(releaseReceipt.archive.sha256, sha256(archive));
  assert.equal(releaseReceipt.id, 'charity-sourcing');
  assert.equal(releaseReceipt.version, '0.5.0');
  assert.equal(releaseReceipt.minAppVersion, '1.14.4');
  assert.equal(releaseReceipt.isDesktopOnly, false);
  assert.equal(releaseReceipt.thirdPartyNotices.dependencies, 2);
  const legal = await collectLegalNotices(root);
  assert.equal(releaseReceipt.thirdPartyNotices.sha256, sha256(legal.text));
  assert.ok(entries.has('charity-sourcing/licenses/obsidian-maps-MIT.txt'));
  assert.ok(entries.has('charity-sourcing/licenses/dependencies/runtime-library@1.0.0/LICENSE'));
});

test('packaging rejects inconsistent version or platform metadata before writing artifacts', async t => {
  const root = await fixture(t);
  const manifestPath = path.join(root, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  for (const invalid of [
    { ...manifest, version: '0.4.2' },
    { ...manifest, isDesktopOnly: true },
    { ...manifest, minAppVersion: '1.0.0' }
  ]) {
    await fs.writeFile(manifestPath, JSON.stringify(invalid));
    await assert.rejects(() => packagePlugin(root), /metadata mismatch|manifest\/version mismatch/);
    await assert.rejects(() => fs.stat(path.join(root, 'dist')), { code: 'ENOENT' });
  }
});

test('packaging fails when a bundled dependency has no redistribution notice', async t => {
  const root = await fixture(t);
  await fs.unlink(path.join(root, 'node_modules/runtime-library/LICENSE'));
  await assert.rejects(() => packagePlugin(root), /No redistribution notice found for runtime-library/);
  await assert.rejects(() => fs.stat(path.join(root, 'dist')), { code: 'ENOENT' });
});

test('release metadata is shared across platforms while Clipper release stays independently versioned', async () => {
  const readJson = async (name: string) => JSON.parse(await fs.readFile(path.join(project, name), 'utf8'));
  const [pkg, lock, manifest, versions] = await Promise.all(['package.json', 'package-lock.json', 'manifest.json', 'versions.json'].map(readJson));
  assert.equal(pkg.version, '0.11.0');
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.isDesktopOnly, false);
  assert.equal(manifest.minAppVersion, '1.14.4');
  assert.equal(versions[pkg.version], manifest.minAppVersion);
  assert.match(await fs.readFile(path.join(project, 'src/capture/index.ts'), 'utf8'), /CLIPPER_TEMPLATE_RELEASE = '0\.4\.2'/);
});
