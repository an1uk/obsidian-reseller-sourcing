import { CLIPPER_TEMPLATE_RELEASE } from '../capture';
import { stringify } from 'yaml';
import type { CaptureDraft, PlaceKind } from '../types';
import { validateRootPath } from '../domain';
import { wiki, writeNote } from './markdown';

export const ASSET_VERSION = 15;
export const VIEW_TYPE = 'charity-sourcing-map';

export function bodyForPlace(draft?: CaptureDraft, kind: PlaceKind = draft?.kind ?? 'shop'): string {
  if (kind === 'shop') return '```charity-sourcing\nview: place\n```\n\n## Notes\n\n\n';
  const lines = (values: string[]) => values.map(v => '> - ' + v.replace(/[\r\n]+/g, ' ')).join('\n');
  const snapshot = draft ? `> Google: ${draft.googleRating ?? 'Not available'} · ${draft.googleReviewCount ?? 'Unknown'} reviews · checked ${draft.capturedAt.slice(0, 10)}\n>\n` : '';
  return '```charity-sourcing\nview: place\n```\n\n## Visit log\n\n\n## Notes\n\n\n' +
    '> [!info]- Opening hours and Google details\n' + snapshot + '> **Opening hours**\n>\n' + lines(draft?.hours ?? []) +
    '\n>\n> **Review topics**\n>\n' + lines(draft?.topics ?? []) + '\n';
}

export function placeProperties(kind: PlaceKind, locality = '', sourceType = 'Charity shop'): Record<string, unknown> {
  const type = sourceType.trim() || 'Other';
  const sourceTags = ['places', 'sourcing-source', ...(type.toLowerCase() === 'charity shop' ? ['charity-shop'] : [])];
  const common = { tags: kind === 'shop' ? sourceTags : ['places', 'parking'], locality: locality ? wiki(locality) : '', coordinates: [], address: '', website: '', telephone: '', google_name: '', google_maps_url: '', google_checked: null };
  return kind === 'shop' ? { ...common, source_type: type, rating: 0, comments: '', shortlist: false, last_visited: null, shop_closed: false,
    parking_on_site: 'unknown', on_site_parking_cost: 'unknown', on_site_parking_availability: 'unknown', parking_location: '',
    google_rating: null, google_review_count: null, google_review_topics: [], google_review_topics_checked: null, google_hours: [], google_hours_checked: null } : { ...common, parking_cost: 'unknown', parking_availability: 'unknown', parking_checked: null, parking_for: [] };
}

function localitySegments(root: string, locality: string): string[] {
  if (locality.startsWith(root + '/Places/') && locality.endsWith('/Area.md')) return locality.slice((root + '/Places/').length, -'/Area.md'.length).split('/');
  const prefix = root + '/Localities/';
  if (!locality.startsWith(prefix) || !locality.endsWith('.md')) throw new Error('Choose a locality note inside this sourcing folder.');
  const segments = locality.slice(prefix.length, -3).split('/');
  if (segments.some(part => !part || part === '.' || part === '..' || /[\\\r\n]/.test(part))) throw new Error('Invalid locality path.');
  return segments;
}

export function baseText(root: string, kind?: PlaceKind, localityPath?: string, vaultName = ''): string {
  root = validateRootPath(root);
  const folders = kind === 'parking' ? ['Places', 'Parking'] : kind === 'shop' ? ['Places', 'Sources', 'Shops'] : ['Places', 'Sources', 'Shops', 'Parking'];
  const folderFilter = (suffix = '') => folders.map(folder => `file.inFolder(${JSON.stringify(root + '/' + folder + suffix)})`).join(' || ');
  const sourceTag = '(file.hasTag("sourcing-source") || file.hasTag("charity-shop"))';
  const filters = ['file.ext == "md"', 'note.sourcing_example != true', folderFilter(), '!file.hasTag("map-demo")', kind === 'shop' ? sourceTag : kind === 'parking' ? 'file.hasTag("parking")' : sourceTag + ' || file.hasTag("parking")'];
  const subtree = localityPath ? '/' + localitySegments(root, localityPath).join('/') : '';
  const formulas: Record<string, string> = {
    is_source: sourceTag,
    source_type: 'if(note.source_type.isType("string") && note.source_type.trim() != "", note.source_type.trim(), if(file.hasTag("charity-shop"), "Charity shop", "Unspecified"))',
    place_type: 'if(formula.is_source, formula.source_type, "Parking")',
    area_file: 'if(note.locality.isType("link"), note.locality.asFile(), null)',
    area: `if(formula.area_file.isType("file"), link(formula.area_file.path, if(formula.area_file.inFolder(${JSON.stringify(root + '/Places')}), formula.area_file.path.replace(${JSON.stringify(root + '/Places/')}, "").replace(/\\/Area\\.md$/, "").replace(/\\//g, " → "), formula.area_file.path.replace(${JSON.stringify(root + '/Localities/')}, "").replace(/\\.md$/, "").replace(/\\//g, " → "))), if(note.locality, note.locality, "Unassigned"))`,
    brand: 'list(note.tags).filter(value.isType("string") && (value.startsWith("source/") || value.startsWith("charity-shop/"))).map(value.replace(/^source\\//, "").replace(/^charity-shop\\//, "").replace(/-/g, " ")).unique().sort().join(", ")',
    marker_icon: 'if(formula.is_source, "store", "square-parking")',
    valid_rating: 'note.rating.isType("number") && note.rating >= 0 && note.rating <= 5 && (note.rating * 2).floor() == note.rating * 2',
    sourcing_assessment: 'if(!formula.valid_rating || note.rating == 0, "0 · Not rated", note.rating + " / 5")',
    marker_color: 'if(!formula.is_source, "#7c3aed", if(note.rating == 0 || !formula.valid_rating, "#3b82f6", if(note.rating < 2, "#ef4444", if(note.rating < 4, "#f59e0b", "#22c55e"))))',
    has_location: 'if(note.coordinates.isType("list") && note.coordinates.length == 2, /^[+-]?(\\d+(\\.\\d+)?|\\.\\d+)$/.matches(note.coordinates[0].toString().trim()) && /^[+-]?(\\d+(\\.\\d+)?|\\.\\d+)$/.matches(note.coordinates[1].toString().trim()) && number(note.coordinates[0]) >= -90 && number(note.coordinates[0]) <= 90 && number(note.coordinates[1]) >= -180 && number(note.coordinates[1]) <= 180, false)',
    google_maps: 'if(note.google_maps_url, link(note.google_maps_url, "Google Maps"), if(formula.has_location, link("https://www.google.com/maps/search/?api=1&query=" + note.coordinates[0] + "," + note.coordinates[1], "Google Maps"), ""))',
    action_path: 'file.path.replace("%", "%25").replace("&", "%26").replace("+", "%2B").replace("?", "%3F").replace("#", "%23").replace("=", "%3D").replace(" ", "%20")',
    drive: `if(formula.has_location || note.parking_location, link(${JSON.stringify('obsidian://charity-sourcing?vault=' + encodeURIComponent(vaultName) + '&action=drive&path=')} + formula.action_path, "Drive here"), "")`,
    walk: `if(formula.has_location, link(${JSON.stringify('obsidian://charity-sourcing?vault=' + encodeURIComponent(vaultName) + '&action=walk&path=')} + formula.action_path, "Walk here"), "")`,
  };
  if (localityPath) {
    const areaLink = JSON.stringify(localityPath.replace(/\.md$/, ''));
    const relatedScope = ['Sources', 'Shops'].map(folder => `value.inFolder(${JSON.stringify(root + '/' + folder + subtree)})`).join(' || ');
    formulas.related_area_sources = 'if(formula.is_source, [], ' +
      '(list(note.parking_for).filter(value.isType("link")).map(value.asFile()) + ' +
      'file.backlinks.map(value.asFile()).filter(value.isType("file") && list(value.properties.parking_location).contains(file)))' +
      '.filter(value.isType("file") && value.ext == "md" && (value.hasTag("sourcing-source") || value.hasTag("charity-shop")) && !value.hasTag("map-demo") && value.properties.shop_closed != true && (' + relatedScope + ' || value.properties.locality == link(' + areaLink + '))))';
    formulas.locality_shortlisted = 'if(formula.is_source, note.shortlist == true && note.shop_closed != true, formula.related_area_sources.filter(value.properties.shortlist == true).length > 0)';
    filters.push('(' + folderFilter(subtree) + ') || note.locality == link(' + areaLink + ') || formula.related_area_sources.length > 0');
  }
  const properties = {
    'file.name': { displayName: kind === 'parking' ? 'Parking' : localityPath ? 'Place' : 'Source' },
    'note.locality': { displayName: 'Area' }, 'formula.area': { displayName: 'Area' }, 'formula.source_type': { displayName: 'Source type' },
    'formula.place_type': { displayName: 'Type' }, 'formula.brand': { displayName: 'Brand / name' },
    'note.source_type': { displayName: 'Source type' }, 'note.rating': { displayName: 'Sourcing rating' },
    'note.comments': { displayName: 'Takeaway' },
  };
  const order = kind === 'parking' ? ['file.name', 'formula.area', 'parking_cost', 'parking_availability', 'parking_checked', 'formula.drive']
    : localityPath ? ['file.name', 'formula.place_type', 'formula.area', 'rating', 'comments', 'parking_cost', 'parking_availability']
    : ['file.name', 'formula.source_type', 'formula.area', 'rating', 'comments', 'shortlist', 'last_visited'];
  const active = '!formula.is_source || note.shop_closed != true';
  const map = (name: string, extra: string[] = []) => ({ type: VIEW_TYPE, name, filters: { and: [active, ...extra] },
    order: ['file.name', 'formula.place_type', 'formula.sourcing_assessment', 'comments', 'last_visited', 'parking_cost', 'parking_availability'],
    coordinates: 'note.coordinates', markerIcon: 'formula.marker_icon', markerColor: 'formula.marker_color', mapHeight: 680, maxZoom: 15, fitPadding: 64 });
  const table = (name: string, extra?: string[], groupBy?: string, tableOrder = order) => ({ type: 'table', name, order: tableOrder,
    ...(extra ? { filters: { and: extra } } : {}), ...(groupBy ? { groupBy: { property: groupBy, direction: 'ASC' } } : {}), sort: [{ property: 'file.name', direction: 'ASC' }] });
  const views: unknown[] = [map(localityPath ? 'Locality map' : 'Map'), table(kind === 'parking' ? 'All parking' : localityPath ? 'Area places' : 'All sources')];
  if (localityPath) views.push(map('Locality shortlist map', ['formula.locality_shortlisted']), table('Locality shortlist', [active, 'formula.locality_shortlisted']));
  views.push(table('By area', undefined, 'formula.area'));
  if (kind === 'shop') views.push(
    map('Shortlist map', ['note.shortlist == true']), table('Shortlist', [active, 'note.shortlist == true']),
    table('By source type', undefined, 'formula.source_type'), table('By brand', undefined, 'formula.brand'), table('By parking', undefined, 'parking_location'),
    table('Parking', undefined, undefined, ['file.name', 'formula.area', 'parking_on_site', 'on_site_parking_cost', 'on_site_parking_availability', 'parking_location']),
    table('Review comparison', undefined, undefined, ['file.name', 'formula.source_type', 'formula.area', 'rating', 'google_rating', 'google_review_count', 'google_checked', 'google_review_topics']),
    table('No visit recorded', [active, '!note.last_visited']), table('Needs location', ['!formula.has_location'])
  );
  return stringify({ filters: { and: filters }, formulas, properties, views }, { lineWidth: 0 });
}

export function classicBundledAssets(root: string, vaultName = ''): Record<string, string> {
  root = validateRootPath(root);
  const wide = (body: string) => writeNote({ cssclasses: ['charity-sourcing-wide'] }, body);
  return {
    [`${root}/Home.md`]: wide('```charity-sourcing\nview: home\n```\n'),
    [`${root}/Sources.md`]: wide('```charity-sourcing\nview: navigation\n```\n\n' + `![[${root}/System/Sources.base#All sources]]\n`),
    [`${root}/Parking.md`]: wide('```charity-sourcing\nview: navigation\n```\n\n' + `![[${root}/System/Parking.base#All parking]]\n`),
    [`${root}/Visits.md`]: wide('```charity-sourcing\nview: visits\n```\n'),
    [`${root}/Outings.md`]: wide('```charity-sourcing\nview: outings\n```\n'),
    [`${root}/Localities.md`]: wide('```charity-sourcing\nview: localities\n```\n'),
    [`${root}/System/Sources.base`]: baseText(root, 'shop', undefined, vaultName),
    [`${root}/System/Parking.base`]: baseText(root, 'parking', undefined, vaultName),
    [`${root}/Templates/Source.md`]: writeNote(placeProperties('shop'), bodyForPlace()),
    [`${root}/Templates/Parking.md`]: writeNote(placeProperties('parking'), bodyForPlace(undefined, 'parking')),
    [`${root}/Guide.md`]: `Start at [[${root}/Home|Home]]. Resume saved work, record a visit, plan an outing or find a source. Browse notebook holds the full lists; Help and notebook tools holds setup, templates and examples.\n\n` +
      '## A small start\n\nHome shows an interrupted save, unfinished visit or active outing when one is available. Opening Home never resumes or completes work automatically. Record a visit can save just a quick note or purchase count; other details are optional. Keep draft and close saves unfinished input without recording a completed visit. Find sources opens the full map and table browser.\n\n## Desktop and Android\n\nThe same plugin build supports both platforms. On a second device, finish syncing your vault, then choose Use existing notebook in Setup. Preview its folder and confirm; connecting does not rewrite notes or repair customised components. Ambiguous old captures stay untouched for review on the originating desktop.\n\nUse Web Clipper on desktop, then sync the source notes. Android supports manual entry, visits, ratings, shared parking, areas and outings; browser extraction on Android is deferred. Touch a map marker to open its details, use Map actions for coordinates and camera settings, and use the location button only when wanted. Location tracking stops when the app backgrounds. Maps need WebGL2 and internet tiles; notes remain available if a map cannot load.\n\nVault sync is managed by Obsidian or your chosen service. Finish sync before switching devices or changing notebook organisation.\n\n' +
      '## Fictional examples\n\nChoose Add examples on Home or in settings for an optional, separate practice notebook with 24 invented sources. Its maps, visits, parking, captures and outings are editable without changing real records. The optional Guided tour folder can be deleted separately. Deleting any example content is permanent across repair and updates; it is created only through an explicit Add examples action. Fictional contact and navigation actions show previews.\n\n' +
      '## Sources\n\nSources can be charity shops, rag houses, wholesalers, markets or another type you choose. Source type, area and brand each have a grouped table. Use the table controls to search, filter and sort. Your sourcing score is separate from Google’s public review score.\n\n' +
      `## Capture\n\nIn Home, plugin settings or the command palette, choose Set up / update Web Clipper. The guide shows each available template version, offers Copy Source JSON and Copy Parking JSON, and remembers your import confirmations. In Clipper, open the Settings cog, select any template, choose Import, paste JSON and choose Import again. You can also select or drop both Capture source.json and Capture parking.json in that dialog. Do not use Import all settings.\n\nUse Source v${CLIPPER_TEMPLATE_RELEASE} — Google Maps or Parking v${CLIPPER_TEMPLATE_RELEASE} — Google Maps for one Google Maps listing. Review the source type, town, optional locality, coordinates and filename before saving. Missing information stays editable.\n\nA new browser import creates another template, rather than replacing an older copy. Check and test the new version before removing old copies or moving them below it; Clipper uses the first matching template. Templates without a visible version are older than these exports. The template release is separate from the compatible capture format.\n\nExisting version 1 and version 2 captures remain readable. Blank version 2 source types use your current default source type; an explicit captured type remains unchanged. After a template or notebook-destination change, unchanged owned JSON exports update locally and an import reminder appears once. Re-import the exported JSON manually using the guide, then confirm each import. These confirmations record your choice; Obsidian cannot check or replace browser templates. Edited JSON exports are kept and the guide can copy the current supplied JSON. Pending captures remain available.\n\n` +
      'Captures wait in Capture inbox until saved; processed raw captures remain in Capture archive. Review captures can resume after the plugin was disabled. Saving a capture does not overwrite an existing source or record a visit.\n\n' +
      '## Contact details\n\nWebsite and telephone are optional. Capture them from the selected Google Maps listing or enter details from another source manually. Use Edit contacts on a saved place, then Save contacts; Website and Call open the stored contact links. Re-import both Capture source.json and Capture parking.json to enable contact capture in Web Clipper.\n\nProperties start collapsed in these place notes and can be expanded when needed. This does not change the global Obsidian properties setting.\n\n' +
      '## Areas\n\nChoose or create a town, with an optional locality beneath it, such as Exampletown → Riverside. A source can belong directly to its town. Captured postal address text can suggest a town and a clearly stated locality; confirm the destination before saving. Building and shopping-centre names do not establish a locality. The original Google address is retained separately. Nearby suggestions use the nearest assigned source or parking pin within the distance chosen in settings.\n\n' +
      'Plugin settings provide a default source type for faster entry. Town and locality suggestions come from the captured address, remembered address phrases or your explicit choice. Explicit captured types remain authoritative. When assigning a capture, you can remember an editable address phrase for the selected town and locality. Remembered phrases are local suggestions; disabled, missing or conflicting hints do not choose an area automatically. Review or remove hints in settings.\n\nUse Change area on a saved place to review a new town or locality and its destination. User-edited filenames and the note body are retained. Use the area controls to rename an area or change its parent; source and parking folders follow that hierarchy. Home provides recent areas and shortcuts to sources, parking and the shortlist.\n\n' +
      'In an area’s Base view menu, choose Locality map for all active places or Locality shortlist map for shortlisted sources and their associated parking. Only the selected view is shown.\n\n' +
      '## Refresh a source from a clip\n\nClip the same full Google Maps listing again and review the capture. An exact saved listing opens Review source updates; multiple exact matches require a target choice. Nonempty changes are selected, while pin changes need your selection. Missing details never erase saved values. Review figures, hours and topics keep their own checked dates. Apply selected updates, or explicitly keep the existing details and archive the clip. Cancelling leaves the capture pending. Your sourcing assessment, visits, area, filename and parking stay unchanged. Current captured details are expandable in the source controls; original body snapshots stay as historical content.\n\n' +
      '## Outings\n\nCreate an outing from Home, select sources from your shortlist or search by area and type, and choose parking for walking groups. Outing parking choices do not change the sources\u2019 saved preferences. Plan journey adds a reviewed local schedule: choose a start, date, departure time and timezone, allow 20 minutes per source or individual overrides, then compare shorter distance or fit opening hours. New plans finish at the last source; return to start is optional. Miles is the default distance unit; choose Miles or Kilometres in settings. Existing saved endpoints stay unchanged. Driving uses selected parking groups, with walking between shops and back to parking. Estimated travel uses editable straight-line assumptions, not roads or traffic. Unknown hours stay unconfirmed; date-specific overrides do not change captured Google details. Review arrival, waiting and departure times before Use suggested plan. Keep current plan saves nothing. Complete unfinished visit drafts first.\n\nOnly one outing is active at a time. Record visit saves observations and optional assessment updates, then advances progress. Visited without notes and Skip change only the outing. Update last visited remains explicit, and the permanent shortlist stays unchanged. Unfinished visit drafts are kept for Resume or Discard. Undo restores progress without deleting a saved visit; finishing keeps unfinished stops visible.\n\nUse Drive to parking, Walk to source and Return to parking. Saved lists, progress and drafts work without map tiles. Missing pins and broken links remain visible for correction.\n\nOpen route in Google Maps previews the saved driving order. Remaining stops is the default; choose All stops to include visited and skipped stops. Each group uses its chosen parking, or its first included source pin when no parking is selected. Correct missing destinations or explicitly exclude them from this route. Choose Android app, Desktop or Mobile browser to use the supported destination capacity. A saved return or finish counts as a destination. Routes that fit are sent as one journey; longer routes split into the fewest numbered parts, with each later part starting at the previous destination. Open only the part you need, or copy its link. These actions do not change outing progress or parking preferences. Google Maps may handle waypoints differently across devices; individual directions remain available.\n\n' +
      '## Visits and parking\n\nNew visit records are separate Markdown notes in Visits/YYYY/MM, linked from their source and outing. The actual visit date is editable; the recording timestamp is fixed. Visits opens a newest-first history with All visits, This week, Previous week and Custom dates. Weeks run Monday to Sunday. Switch to Insights for comparisons. Flat older records and nested records both appear; existing files are not moved. Editing a historical date keeps its original file path. Add optional items bought, whole-haul profit potential from 1 (weak) to 5 (exceptional), and one presumed new-stock colour with confirmed, suspected or unknown evidence. A blank count means unknown; zero means no purchases and no haul score applies. These are expected sourcing outcomes, not realised profit or individual inventory records. Existing inline logs stay unchanged.\n\nReview visits on an outing records missing details or edits a linked visit even after finishing, without restarting the outing. Updating a skipped stop requires an explicit change to visited. Standalone and outing drafts survive closing. Historical edits do not change the current assessment unless selected. Visit insights compares actual visit weekdays, count coverage, averages including zeros, buying percentages and median haul scores. Small samples and pooled shop mixes are clearly labelled. Confirmed branch-specific colour histories can show possible observed repeats after two returns with another colour between; uncertain evidence needs explicit inclusion, conflicting dates are excluded, and no future colour or stock timetable is predicted.\n\nUpdate last visited is an explicit choice. Recording a visit does not clear the shortlist. The current sourcing score is your judgement: 0 means unrated; use half-star steps from 0.5 to 5. Approximately 1 means rarely worthwhile, 3 worth checking nearby and 5 worth a special trip.\n\n' +
      'Create or select a reusable parking note from a source’s map. One parking place can serve several sources. Choose a preferred destination when there are alternatives. Driving uses the selected parking; walking targets the source. Parking availability records your usual experience, not live availability.\n\n' +
      '## Maps and data\n\nMaps use free OpenFreeMap tiles with OpenStreetMap data and need internet access. Notes, visits and tables remain usable without tiles. Fit all restores automatic framing after panning. Closed sources remain in tables and leave active maps and shortlist views. Google details are a dated snapshot.\n\n' +
      'Core Bases is required; Web Clipper is optional. Markdown and YAML stay in the vault when this plugin is disabled, while its interactive map and controls stop rendering. Purchasing and sales remain in LyList.\n\n' +
      '## Credits\n\nMap implementation adapted from [Obsidian Maps 0.2.2](https://github.com/obsidianmd/obsidian-maps), MIT © 2025 Obsidian. MapLibre and bundled dependencies retain their licences in the plugin package. Map backgrounds: [OpenFreeMap](https://openfreemap.org), © OpenMapTiles, data © OpenStreetMap contributors. See plugin Settings → About / Credits for full notices.\n',
  };
}

export function bundledAssets(root: string, vaultName = ''): Record<string, string> {
  const original = classicBundledAssets(root, vaultName);
  return {
    [root + '/Home.md']: '```charity-sourcing\nview: home\n```\n',
    [root + '/System/Sources.base']: original[root + '/System/Sources.base']!,
    [root + '/System/Parking.base']: original[root + '/System/Parking.base']!,
    [root + '/System/Templates/Source.md']: original[root + '/Templates/Source.md']!,
    [root + '/System/Templates/Parking.md']: original[root + '/Templates/Parking.md']!,
    [root + '/System/Guide.md']: 'Open the Sourcing workspace from the store ribbon icon or [[' + root + '/Home|Home]].\n\n' +
      '## Choose where to go\n\nChoose an area or your shortlist, select places, review the journey, then start or save it for later. Preparation is saved as you go. Improve journey offers distance and opening-hours planning; it is optional. Return to start is off, visits allow 20 minutes, and distances use miles unless changed in settings.\n\n' +
      '## At a place\n\nRecord visit and Directions are the main actions. Maps, visit history and reference details have their own sections. Driving uses the selected parking; walking targets the source. Parking can serve several sources. Missing pins remain editable.\n\n' +
      '## Record a visit\n\nDate, items purchased and a quick note are enough. Blank purchase counts mean unknown; zero means nothing bought. Close keeps the draft. Save visit records it. Other details and assessment changes are optional. History provides Monday-to-Sunday weekly browsing and Insights for purchase and stock-colour comparisons.\n\n' +
      '## Capture and organise\n\nMore contains Review captures, Web Clipper templates, examples and settings. Source v0.4.2 and Parking v0.4.2 create reviewed captures in Capture inbox. Exact listing matches offer a reviewed update; captures never silently overwrite a source. Clipper imports remain manual. New manual places need only a name and can stay Unassigned.\n\n' +
      'Places contains sources, parking and area notes grouped by town and optional locality. Visits and Outings use year/month folders. System holds templates, processed raw captures, drafts, views and recovery. Open note provides direct access to readable Markdown.\n\n' +
      '## Desktop, Android and practice\n\nThe shared plugin supports both platforms. Desktop remains the browser capture target. Sync the vault with your chosen service before switching devices; use Use existing notebook to attach on another device. More offers a separate fictional Examples notebook. Practice edits stay there and external destinations are previews. Examples and the optional tour are only installed on request and never restored by an update.\n\n' +
      '## Maps and credits\n\nFree OpenFreeMap tiles use OpenStreetMap data and need internet access. Notes remain usable without tiles. Location is requested only when you choose it and stops when the map closes or the app backgrounds. Map code is adapted from Obsidian Maps 0.2.2 under MIT. Full notices are in Settings, About / Credits. Purchasing and sales remain outside this notebook.\n',
  };
}
