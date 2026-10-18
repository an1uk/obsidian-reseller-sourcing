import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { transformSync } from 'esbuild';

type FakeElement = {
  tag?: string; textContent?: string; value?: string; rows?: number; readOnly?: boolean;
  attributes: Record<string, string>; style: Record<string, string>; children: FakeElement[];
  createEl(tag: string, options?: any): FakeElement; createDiv(options?: any): FakeElement;
  addClass(...names: string[]): void; empty(): void; setText(value: string): void;
  focus(): void; select(): void; selected?: boolean; focused?: boolean;
};
function element(tag = 'div', options: any = {}): FakeElement {
  return {
    tag, textContent: options.text ?? '', attributes: options.attr ?? {}, style: {}, children: [],
    createEl(childTag, childOptions) { const child = element(childTag, childOptions); this.children.push(child); return child; },
    createDiv(childOptions) { return this.createEl('div', childOptions); },
    addClass() {}, empty() { this.children = []; }, setText(text) { this.textContent = text; },
    focus() { this.focused = true; }, select() { this.selected = true; }
  };
}

function mobileHost() {
  const nativeRequests: string[] = [], opened: any[] = [], cleanup: (() => void)[] = [];
  const commands: any[] = [], layout: (() => void)[] = [], notices: string[] = [], processors = new Map<string,any>();
  let adapterReads = 0, timer = 0;
  const adapter = Object.defineProperty({}, 'getBasePath', { get() { adapterReads++; throw Error('A mobile adapter must not be asked for a desktop path'); } });
  const app = {
    vault: { adapter, on: () => ({}), getAbstractFileByPath: () => null, getMarkdownFiles: () => [] },
    metadataCache: { on: () => ({}), getFileCache: () => null },
    workspace: { on: () => ({}), onLayoutReady: (run: () => void) => { layout.push(run); }, getLeavesOfType: () => [], getActiveFile: () => null }
  };
  class Base {
    app = app;
    containerEl = element(); contentEl = element(); modalEl = element(); titleEl = element();
    async loadData() { return { root: 'Existing notebook', setupVersion: 5 }; }
    async saveData() {}
    register(run: () => void) { cleanup.push(run); }
    registerEvent() {}
    registerBasesView() { return true; }
    registerView() {}
    addSettingTab() {}
    registerObsidianProtocolHandler() {}
    addRibbonIcon() {}
    addCommand(command: any) { commands.push(command); }
    registerMarkdownCodeBlockProcessor(type:string,run:any) { processors.set(type,run); }
    open() { opened.push(this); (this as any).onOpen?.(); }
    close() { (this as any).onClose?.(); }
  }
  class Setting {
    constructor(_el: unknown) {}
    setName() { return this; } setDesc() { return this; }
    addButton(run: (button: any) => void) { const button = { setButtonText: () => button, onClick: () => button }; run(button); return this; }
  }
  class Notice { constructor(message: string) { notices.push(message); } }
  const obsidian = new Proxy({
    Plugin: Base, PluginSettingTab: Base, Modal: Base, MarkdownRenderChild: Base,
    Setting, Notice, Platform: { isMobileApp: true, isDesktopApp: false, isAndroidApp: true, isWin: false }
  } as Record<string, unknown>, { get(target, key) { return target[String(key)] ?? Base; } });
  const module = { exports: {} as { default: new () => any } };
  const requireMobile = (id: string) => {
    if (id !== 'obsidian') { nativeRequests.push(id); throw Error('Native module unavailable on Android: ' + id); }
    return obsidian;
  };
  const context = {
    module, exports: module.exports, require: requireMobile, console,
    URL, URLSearchParams, TextEncoder, TextDecoder, structuredClone, crypto: webcrypto,
    window: { setTimeout: () => ++timer, clearTimeout() {} }, setTimeout: () => ++timer, clearTimeout() {}
  };
  return { module, context, app, requireMobile, opened, cleanup, commands, layout, notices, processors, nativeRequests, adapterReads: () => adapterReads };
}

function bundledPlugin() {
  const host = mobileHost();
  vm.runInNewContext(fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8'), host.context, { timeout: 15000 });
  return { ...host, plugin: new host.module.exports.default() };
}

test('the exact shared plugin bundle evaluates in Android mode with all Node and Electron modules unavailable', () => {
  const { module, nativeRequests, plugin } = bundledPlugin();
  assert.equal(typeof module.exports.default, 'function');
  assert.equal(plugin.settings.root, 'Reseller sourcing');
  assert.deepEqual(nativeRequests, []);
  const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.id, 'charity-sourcing');
  assert.equal(manifest.version, '0.11.0');
  assert.equal(manifest.isDesktopOnly, false);
  assert.equal(manifest.minAppVersion, '1.14.4');
});

test('Android startup registers core sourcing commands without consulting desktop adapters or modules', async () => {
  const { plugin, commands, nativeRequests, layout, cleanup, adapterReads } = bundledPlugin();
  await plugin.onload();
  for (const id of ['new-shop', 'new-parking', 'add-visit', 'new-outing', 'resume-outing', 'new-locality', 'setup']) {
    assert.ok(commands.some(command => command.id === id), id);
  }
  for (const ready of layout) ready();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(nativeRequests, []);
  assert.equal(adapterReads(), 0);
  for (const run of cleanup) run();
});

test('Android template location is selectable and desktop launch integrations never resolve native modules', async () => {
  const { plugin, opened, nativeRequests, adapterReads } = bundledPlugin();
  plugin.store = { root: 'Synced notebook', paths: { templates: 'Synced notebook/System/Templates' } };
  await plugin.revealTemplates('shop');
  const modal = opened.at(-1);
  assert.ok(modal, 'Mobile needs a selectable vault-relative path');
  const textarea = modal.contentEl.children.find((child: FakeElement) => child.tag === 'textarea');
  assert.ok(textarea);
  assert.match(textarea.value, /^Synced notebook\/System\/Templates\/Web Clipper/);
  assert.equal(textarea.style.userSelect, 'text');
  assert.equal(await plugin.openClipperImportTools(), false);
  assert.equal(adapterReads(), 0);
  assert.deepEqual(nativeRequests, []);
});

test('clipboard denial supplies selectable fallback text without losing the exact value', async () => {
  const host = mobileHost(), module = { exports: {} as any };
  const code = transformSync(fs.readFileSync(new URL('../src/platform/clipboard.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
  let attempts = 0;
  vm.runInNewContext(code, {
    module, exports: module.exports, require: host.requireMobile,
    navigator: { clipboard: { writeText: async () => { attempts++; throw Error('denied'); } } }
  });
  const value = 'Synced notebook/Templates/Web Clipper\nA second selectable line';
  assert.equal(await module.exports.copyTextOrShow(host.app, value, 'Notebook template folder'), false);
  assert.equal(attempts, 1);
  const modal = host.opened[0];
  assert.equal(modal.titleEl.textContent, 'Notebook template folder');
  const textarea = modal.contentEl.children.find((child: FakeElement) => child.tag === 'textarea');
  assert.equal(textarea.value, value);
  assert.equal(textarea.attributes.readonly, 'true');
  assert.equal(textarea.style.userSelect, 'text');
  assert.deepEqual(host.nativeRequests, []);
});

test('clipboard absence also falls back while successful copy avoids a modal', async () => {
  for (const available of [false, true]) {
    const host = mobileHost(), module = { exports: {} as any }, copied: string[] = [];
    const code = transformSync(fs.readFileSync(new URL('../src/platform/clipboard.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
    vm.runInNewContext(code, {
      module, exports: module.exports, require: host.requireMobile,
      navigator: available ? { clipboard: { writeText: async (value: string) => { copied.push(value); } } } : {}
    });
    assert.equal(await module.exports.copyTextOrShow(host.app, '12.123, 45.234'), available);
    assert.deepEqual(copied, available ? ['12.123, 45.234'] : []);
    assert.equal(host.opened.length, available ? 0 : 1);
  }
});

test('closing a caller during a pending clipboard request suppresses a late fallback dialog', async () => {
  const host = mobileHost(), module = { exports: {} as any };
  const code = transformSync(fs.readFileSync(new URL('../src/platform/clipboard.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
  let rejectCopy: (error: Error) => void = () => {}, open = true;
  vm.runInNewContext(code, {
    module, exports: module.exports, require: host.requireMobile,
    navigator: { clipboard: { writeText: () => new Promise((_resolve, reject) => { rejectCopy = reject; }) } }
  });
  const pending = module.exports.copyTextOrShow(host.app, 'https://example.org', 'Route link', () => open);
  open = false; rejectCopy(new Error('denied'));
  assert.equal(await pending, false);
  assert.equal(host.opened.length, 0);
});

test('missing or invalid example context unloads its map owner before clearing the rendered note', async () => {
  for(const unavailable of ['missing','invalid']){
    const host=bundledPlugin();await host.plugin.onload();
    let block:any;host.processors.get('charity-sourcing')('view: place',element(),{sourcePath:'Existing notebook/Examples/Sources/Example.md',addChild(child:any){block=child;}});
    let unloads=0,clears=0;
    const owner={unload(){unloads++;}};
    block.rendered=owner;block.map={};block.context={};
    block.removeChild=(child:typeof owner)=>{assert.equal(child,owner);child.unload();};
    block.containerEl.empty=()=>{assert.equal(unloads,1,'dispose the owner before detaching map DOM');clears++;};
    host.plugin.contextForPath=async()=>{if(unavailable==='invalid')throw Error('Invalid practice state');return undefined;};
    await block.render();
    assert.equal(unloads,1);assert.equal(clears,1);assert.equal(block.map,undefined);assert.equal(block.rendered,undefined);assert.equal(block.context,undefined);
  }
});
