import type { ExamplePack } from './pack';
import { hashText, readNote, writeNote } from '../storage/markdown';
import { bundledAssets, ASSET_VERSION } from '../storage/assets';

/** Only fresh v5 packs use this layout. Existing and historical packs are never transformed. */
export async function workspaceExamplePack(pack: ExamplePack, root: string, vault: string): Promise<ExamplePack> {
  const mapping = new Map<string, string>();
  const remove = new Set(['Sources.md', 'Parking.md', 'Localities.md', 'Outings.md', 'Visits.md']);
  for (const path of Object.keys(pack.files)) {
    const relative = path.slice(root.length + 1);
    if (relative.startsWith('Localities/') && path.endsWith('.md')) mapping.set(path, root + '/Places/' + relative.slice(11, -3) + '/Area.md');
    else if (/^(Sources|Parking)\//.test(relative) && path.endsWith('.md')) mapping.set(path, root + '/Places/' + relative.replace(/^[^/]+\//, ''));
    else if (relative.startsWith('Outings/') && path.endsWith('.md')) mapping.set(path, root + '/Outings/2026/10/' + relative.slice(8));
    else if (relative.startsWith('Capture archive/')) mapping.set(path, root + '/System/' + relative);
    else if (relative === 'Guide.md') mapping.set(path, root + '/System/Guide.md');
  }
  const changes = [...mapping].sort((a, b) => b[0].length - a[0].length);
  const remap = (value: string) => {
    for (const [from, to] of changes) value = value.replaceAll(from, to).replaceAll(from.replace(/\.md$/, '') + '|', to.replace(/\.md$/, '') + '|').replaceAll(from.replace(/\.md$/, '') + ']]', to.replace(/\.md$/, '') + ']]');
    for (const name of remove) value = value.replaceAll('[[' + root + '/' + name.slice(0, -3) + '|', '[[' + root + '/Home|');
    return value;
  };
  const files: Record<string, string> = {};
  for (const [path, original] of Object.entries(pack.files)) {
    const relative = path.slice(root.length + 1), target = mapping.get(path) ?? path;
    if (remove.has(relative) || path.endsWith('/Area map.base')) continue;
    // Raw source captures remain immutable; identities and original revisions stay verifiable.
    let text = /\/(?:Capture inbox|Capture archive)\//.test(path) ? original : remap(original);
    if (target.endsWith('/Area.md')) { const n = readNote(text); n.properties.area_name = path.split('/').pop()!.slice(0, -3); text = writeNote(n.properties, n.body.replace(/!\[\[[^\]]+\.base[^\]]*\]\]/g, '')); }
    if (target.startsWith(root + '/Outings/') && target.endsWith('.md')) {
      const n = readNote(text), outing = n.properties.outing as Record<string, unknown>;
      if (outing?.status === 'active') outing.exampleBackground = true;
      text = writeNote(n.properties, n.body);
    }
    files[target] = text;
  }
  const supplied = bundledAssets(root, vault);
  files[root + '/Home.md'] = writeNote({ sourcing_example: true }, '```charity-sourcing\nview: home\n```\n');
  files[root + '/System/Guide.md'] = writeNote({ sourcing_example: true },
    '> [!info] Fictional practice notebook\n> All places, contacts, visits and reviews are invented. External actions show previews.\n\n' +
    'Open Home to enter the workspace. Choose where to go begins three short stages: choose places, review the journey, then start or save for later. Close at any stage to keep your draft.\n\n' +
    'Places opens a list or map. Open a place for its assessment, reminder, directions and visit button. Details contains contacts and shared parking. History has weekly browsing and Insights.\n\n' +
    'Saved for later contains the four prepared outings, including a partly completed outing with a visit draft. Opening it does not start it. Choose Resume outing explicitly when you want it to become your current practice outing.\n\n' +
    'More contains six prepared captures, practice settings and worked illustrations. The optional Guided tour folder can be deleted separately; deleted examples are never restored by updates.\n');
  files[root + '/Reference/Everyday workflows.md'] = writeNote({ sourcing_example: true },
    '# Everyday workflows — fictional examples\n\n' +
    'Start from Home → Choose where to go. Choose Brindleford or use Shortlist. Add two places, review their shared parking and save for later. Close earlier to test draft restoration; Not now moves a preparation out of Home’s prominent position.\n\n' +
    'Open Places → any source → Record visit. Try a quick note with a blank purchase count (unknown), then another with zero. Extra haul and stock-label fields remain optional. Close to preserve unfinished details.\n\n' +
    'History → Custom dates → 28 September–4 October 2026 spans a month boundary. Insights compares recorded visits, not predicted profit or a guaranteed stock cycle.\n\n' +
    'Places, parking and area records share Places/Town/Locality. New places need only a name and go in Places/Unassigned until organised. Visits and outings use year/month folders. Files are readable records; the workspace supplies everyday navigation.\n');
  files[root + '/Guided tour/Start here.md'] = writeNote({ sourcing_example: true },
    '# Optional practice pointers\n\nAll data here is fictional. These pointers are independent; there is no required order.\n\n' +
    '- [ ] Open [[' + root + '/Home|Home]] and choose where to go. Pick two sources and review shared parking.\n' +
    '- [ ] Close a preparation and return to it through Saved for later. Try Not now.\n' +
    '- [ ] Open a place, record a quick note and zero purchases, then inspect History.\n' +
    '- [ ] Explore More → Review captures for a complete or partial refresh.\n' +
    '- [ ] Open the finished outing and review its visits.\n\nDelete this folder whenever it stops being useful. The 24 places and their working controls remain.\n');
  const settings = JSON.parse(remap(JSON.stringify(pack.settings))) as ExamplePack['settings'];
  settings.assets = {};
  for (const path of Object.keys(supplied)) if (files[path]) settings.assets[path] = { hash: await hashText(files[path]), version: ASSET_VERSION };
  return { files, settings };
}
