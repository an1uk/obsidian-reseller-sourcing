import fs from 'node:fs/promises';
import path from 'node:path';

/** The same notice source feeds both the runtime credits and the universal ZIP. */
export async function collectLegalNotices(root) {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const files = new Map();
  for (const name of ['LICENSE', 'THIRD-PARTY-NOTICES.md']) {
    files.set(name, await fs.readFile(path.join(root, name)));
  }
  for (const name of (await fs.readdir(path.join(root, 'licenses'))).sort()) {
    if ((await fs.stat(path.join(root, 'licenses', name))).isFile()) {
      files.set('licenses/' + name, await fs.readFile(path.join(root, 'licenses', name)));
    }
  }
  const dependencies = [];
  const visited = new Set();
  async function dependency(name, from) {
    let parent = from, directory;
    while (parent === root || parent.startsWith(root + path.sep)) {
      const candidate = path.join(parent, 'node_modules', name);
      try { await fs.access(path.join(candidate, 'package.json')); directory = candidate; break; } catch { /* Try its parent installation. */ }
      if (parent === root) break;
      parent = path.dirname(parent);
    }
    if (!directory) throw Error('Cannot find installed dependency ' + name);
    if (visited.has(directory)) return;
    visited.add(directory);
    const data = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
    const entries = (await fs.readdir(directory)).sort();
    const notices = [];
    const names = entries.filter(n => /^(?:licen[cs]e|copying|copyright|notice)(?:[.\-_]|$)/i.test(n));
    for (const filename of names) {
      if (!(await fs.stat(path.join(directory, filename))).isFile()) continue;
      const target = 'licenses/dependencies/' + data.name.replace(/[^a-zA-Z0-9.-]+/g, '_') + '@' + data.version + '/' + filename;
      files.set(target, await fs.readFile(path.join(directory, filename))); notices.push(target);
    }
    // Some small libraries put their licence inside their README.
    if (!notices.length) {
      const readme = entries.find(n => /^readme(?:\.|$)/i.test(n));
      if (readme) {
        const target = 'licenses/dependencies/' + data.name.replace(/[^a-zA-Z0-9.-]+/g, '_') + '@' + data.version + '/' + readme;
        files.set(target, await fs.readFile(path.join(directory, readme))); notices.push(target);
      }
    }
    if (!notices.length) throw Error('No redistribution notice found for ' + data.name);
    dependencies.push({ name: data.name, version: data.version, license: data.license ?? 'See notice', notices });
    for (const child of Object.keys(data.dependencies ?? {}).sort()) await dependency(child, directory);
  }
  for (const name of [...new Set([...Object.keys(pkg.dependencies ?? {}), 'yaml'])].sort()) await dependency(name, root);
  dependencies.sort((a, b) => a.name.localeCompare(b.name));
  files.set('licenses/dependencies.json', Buffer.from(JSON.stringify(dependencies, null, 2) + '\n'));
  const text = [
    'Reseller sourcing ' + pkg.version + ' - licences and third-party notices',
    'These complete notices are bundled in the plugin and require no network or external files.',
    ...[...files].map(([name, data]) => '\n' + '='.repeat(72) + '\n' + name + '\n' + '='.repeat(72) + '\n\n' + data.toString('utf8'))
  ].join('\n\n');
  return { files, dependencies, text };
}
