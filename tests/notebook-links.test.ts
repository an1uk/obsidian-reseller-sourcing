import test from 'node:test';
import assert from 'node:assert/strict';
import { handleNotebookNavigationClick, type NotebookNavigationHandlers } from '../src/platform/notebook-links';

const root = 'Shared sourcing', path = root + '/Sources/Exampletown/Source & 100% + Café.md';
function eventFor(href: string, options: { inBase?: boolean; prevented?: boolean; button?: number; textNode?: boolean } = {}) {
  let prevented = !!options.prevented, stopped = false;
  const anchor = { nodeType: 1, tagName: 'A', getAttribute: (name: string) => name === 'href' ? href : null,
    closest: (selector: string): unknown => selector === 'a[href]' ? anchor : options.inBase === false ? null : { nodeType: 1 } };
  const child = { nodeType: 1, closest: () => anchor };
  const event = { target: options.textNode ? { nodeType: 3, parentElement: child } : child, button: options.button ?? 0,
    get defaultPrevented() { return prevented; },
    preventDefault: () => { prevented = true; }, stopImmediatePropagation: () => { stopped = true; } } as unknown as Event;
  return { event, prevented: () => prevented, stopped: () => stopped };
}
function handlers() {
  const calls: { path: string; action: string; prevented: boolean }[] = [], errors: unknown[] = [];
  const options: NotebookNavigationHandlers = { root: () => root, navigate: async () => {}, onError: error => errors.push(error) };
  return { calls, errors, options };
}
const url = (sourcePath = path, action = 'drive', vault = 'Desktop notebook') => 'obsidian://charity-sourcing?vault=' +
  encodeURIComponent(vault) + '&action=' + action + '&path=' + encodeURIComponent(sourcePath);

test('legacy Base links with a different vault name navigate locally before native URI routing', async () => {
  const f = eventFor(url()), h = handlers();
  h.options.navigate = async (path, action) => { h.calls.push({ path, action, prevented: f.prevented() }); };
  assert.equal(handleNotebookNavigationClick(f.event, h.options), true);
  assert.equal(f.prevented(), true); assert.equal(f.stopped(), true);
  assert.deepEqual(h.calls, [{ path, action: 'drive', prevented: true }]);
});

test('new links without a vault parameter and touch or keyboard synthesized clicks use the current notebook', () => {
  const h = handlers(), links = [
    'obsidian://charity-sourcing?action=walk&path=' + encodeURIComponent(path),
    url(root + '/Parking/Exampletown/Shared parking.md', 'drive'),
    url(root + '/Shops/Exampletown/Legacy.md', 'walk'),
  ];
  for (const href of links) assert.equal(handleNotebookNavigationClick(eventFor(href, { textNode: true }).event, h.options), true);
});

test('explicit cross-vault note links outside Bases and unrelated external links are untouched', () => {
  const h = handlers();
  for (const [href, inBase] of [[url(), false], ['https://www.google.com/maps/dir/?api=1', true],
    ['obsidian://open?vault=Other&file=Source', true], ['obsidian://charity-sourcing-other?action=walk&path=' + encodeURIComponent(path), true]] as const) {
    const f = eventFor(href, { inBase }); assert.equal(handleNotebookNavigationClick(f.event, h.options), false);
    assert.equal(f.prevented(), false); assert.equal(f.stopped(), false);
  }
});

test('foreign, malformed, ambiguous and non-place paths do not become local navigation actions', () => {
  const h = handlers(), hrefs = [
    url('Another notebook/Sources/Exampletown/Source.md'), url(root + '/Sources.md'), url(root + '/Home.md'),
    url(root + '/Sources/../Parking/Source.md'), url(root + '/Sources/Exampletown//Source.md'),
    url(root + '/Sources/Exampletown/Source.md\\evil'), url(path, 'delete'),
    url() + '&action=walk', url() + '&path=' + encodeURIComponent(path), url() + '&vault=Another',
    url().replace('obsidian://charity-sourcing?', 'obsidian://charity-sourcing/?'),
    url() + '#drive', 'not a URL',
  ];
  for (const href of hrefs) { const f = eventFor(href); assert.equal(handleNotebookNavigationClick(f.event, h.options), false, href); assert.equal(f.prevented(), false); }
});

test('path percent escapes are decoded once and preserve literal percent sequences in filenames', () => {
  const h = handlers(), literal = root + '/Sources/Exampletown/Source%20name.md'; let received = '';
  h.options.navigate = async path => { received = path; };
  assert.equal(handleNotebookNavigationClick(eventFor(url(literal)).event, h.options), true);
  assert.equal(received, literal);
});

test('failed record resolution is reported without falling through to the foreign vault URI', async () => {
  const h = handlers(), error = new Error('Missing record'), f = eventFor(url());
  h.options.navigate = async () => { throw error; };
  assert.equal(handleNotebookNavigationClick(f.event, h.options), true);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.prevented(), true); assert.deepEqual(h.errors, [error]);
});

test('already handled and right-click events stay untouched while middle-click actions stay local', () => {
  const h = handlers();
  assert.equal(handleNotebookNavigationClick(eventFor(url(), { prevented: true }).event, h.options), false);
  assert.equal(handleNotebookNavigationClick(eventFor(url(), { button: 2 }).event, h.options), false);
  assert.equal(handleNotebookNavigationClick(eventFor(url(), { button: 1 }).event, h.options), true);
});

test('practice Base listing and directions use their declared local scope rather than the parent notebook',()=>{
  const exampleRoot=root+'/Examples',examplePath=exampleRoot+'/Sources/Exampletown/Example.md';
  for(const action of ['listing','drive','walk']){
    const h=handlers(),f=eventFor(url(examplePath,action,'Other device'));
    h.options.rootForPath=path=>path.startsWith(exampleRoot+'/')?exampleRoot:root;
    h.options.navigate=async(path,selected)=>{h.calls.push({path,action:selected,prevented:f.prevented()});};
    assert.equal(handleNotebookNavigationClick(f.event,h.options),true);
    assert.deepEqual(h.calls,[{path:examplePath,action,prevented:true}]);
  }
});
