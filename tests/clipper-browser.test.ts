import * as guards from '../src/domain/guards';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { transformSync } from 'esbuild';

type BrowserModule = typeof import('../src/platform/clipper-browser');
const source = fs.readFileSync(new URL('../src/platform/clipper-browser.ts', import.meta.url), 'utf8');
const code = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
const expectedUrl = 'chrome-extension://cnjifjpddelmedmihgijeibhnjfabmlf/settings.html?section=templates';
function browserModule(load?: (id: string) => unknown): BrowserModule {
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: (id: string) => id.endsWith('domain/guards') ? guards : load?.(id) });
  return module.exports as BrowserModule;
}
const pathsOnly = (id: string) => {
  assert.equal(id, 'node:path', 'Resolver may load only Windows path utilities');
  return path;
};

test('Windows Chrome resolution checks the three standard locations in order with one fixed URL argument', () => {
  const api = browserModule(pathsOnly), checked: string[] = [];
  const env = { LOCALAPPDATA: 'C:\\Users\\Fixture User\\AppData\\Local', PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)' };
  const locations = [
    'C:\\Users\\Fixture User\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (let selected = 0; selected < locations.length; selected++) {
    checked.length = 0;
    const launch = api.getChromeSettingsLaunch('win32', env, candidate => { checked.push(candidate); return candidate === locations[selected]; });
    assert.equal(launch!.executable, locations[selected]);
    assert.deepEqual(Array.from(launch!.args), [expectedUrl]);
    assert.deepEqual(checked, locations.slice(0, selected + 1));
  }
  assert.equal(api.CHROME_CLIPPER_SETTINGS_URL, expectedUrl);
});

test('Chrome resolution accepts native Windows environment casing and preserves spaces as one executable path', () => {
  const api = browserModule(pathsOnly);
  const launch = api.getChromeSettingsLaunch('win32', { ProgramFiles: 'D:/Program Files/' }, () => true);
  assert.equal(launch!.executable, 'D:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
  assert.deepEqual(Array.from(launch!.args), [expectedUrl]);
});

test('unsupported platforms, absent installations and unsafe environment roots produce no launch plan', () => {
  let checks = 0;
  const exists = () => { checks++; return true; };
  const api = browserModule(pathsOnly);
  for (const platform of ['darwin', 'linux', 'android', '']) assert.equal(api.getChromeSettingsLaunch(platform, { PROGRAMFILES: 'C:\\Program Files' }, exists), undefined);
  assert.equal(checks, 0);
  for (const root of ['', 'relative', 'C:relative', '\\\\server\\share', 'C:\\Bad\\..\\Root', 'C:\\Bad\\.\\Root', 'C:\\Bad"Root', 'C:\\Bad\u0000Root', 'C:\\Bad:Root']) {
    assert.equal(api.getChromeSettingsLaunch('win32', { PROGRAMFILES: root }, exists), undefined);
  }
  assert.equal(checks, 0);
  assert.equal(api.getChromeSettingsLaunch('win32', { PROGRAMFILES: 'C:\\Program Files' }, () => false), undefined);
  assert.equal(api.getChromeSettingsLaunch('win32', {}, exists), undefined);
});

test('native launch is lazy, uses shell false, hides the helper window and confirms spawn only', async () => {
  const modules: string[] = [], probes: string[] = [], launches: unknown[][] = [];
  let unrefs = 0;
  const api = browserModule(id => {
    modules.push(id);
    if (id === 'node:path') return path;
    if (id === 'node:process') return { platform: 'win32', env: { PROGRAMFILES: 'C:\\Program Files' } };
    if (id === 'node:fs') return { existsSync: (candidate: string) => { probes.push(candidate); return true; } };
    if (id === 'node:child_process') return {
      spawn: (...args: unknown[]) => {
        launches.push(args);
        const child = Object.assign(new EventEmitter(), { unref: () => { unrefs++; } });
        queueMicrotask(() => child.emit('spawn'));
        return child;
      },
    };
    throw new Error('Unexpected module ' + id);
  });
  assert.deepEqual(modules, [], 'Importing the plugin must not inspect or launch Chrome');
  assert.equal(await api.openChromeClipperSettings(), true);
  assert.deepEqual(modules, ['node:process', 'node:fs', 'node:path', 'node:child_process']);
  assert.deepEqual(probes, ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe']);
  assert.equal(launches.length, 1);
  const launch = JSON.parse(JSON.stringify(launches[0]));
  assert.deepEqual(launch, ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [expectedUrl], { shell: false, windowsHide: true, detached: true, stdio: 'ignore' }]);
  assert.equal(unrefs, 1);
});

test('missing Chrome and unsupported native platforms never request process creation', async () => {
  for (const platform of ['darwin', 'win32']) {
    const modules: string[] = [];
    const api = browserModule(id => {
      modules.push(id);
      if (id === 'node:process') return { platform, env: { PROGRAMFILES: 'C:\\Program Files' } };
      if (id === 'node:path') return path;
      if (id === 'node:fs') return { existsSync: () => false };
      throw new Error('Unexpected module ' + id);
    });
    assert.equal(await api.openChromeClipperSettings(), false);
    assert.ok(!modules.includes('node:child_process'));
    if (platform !== 'win32') assert.deepEqual(modules, ['node:process']);
  }
  const mobile = browserModule();
  assert.equal(await mobile.openChromeClipperSettings(), false);
});

test('spawn errors and unavailable desktop modules return false without claiming settings opened', async () => {
  for (const failure of ['sync', 'event', 'module']) {
    const api = browserModule(id => {
      if (failure === 'module') throw new Error('Unavailable module');
      if (id === 'node:process') return { platform: 'win32', env: { PROGRAMFILES: 'C:\\Program Files' } };
      if (id === 'node:path') return path;
      if (id === 'node:fs') return { existsSync: () => true };
      if (id === 'node:child_process') return { spawn: () => {
        if (failure === 'sync') throw new Error('Cannot spawn');
        const child = Object.assign(new EventEmitter(), { unref: () => assert.fail('Failed process cannot detach') });
        queueMicrotask(() => child.emit('error', new Error('Cannot start Chrome')));
        return child;
      } };
      throw new Error('Unexpected module');
    });
    assert.equal(await api.openChromeClipperSettings(), false);
  }
});
