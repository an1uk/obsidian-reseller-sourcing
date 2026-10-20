# Reseller sourcing

An Obsidian plugin for planning sourcing trips, remembering places and recording visits. Version **0.14.0** is an **early release** for desktop and Android. Your records remain readable Markdown and YAML; inventory and sales can stay in your existing tools.

Download the [0.14.0 release](https://github.com/an1uk/obsidian-reseller-sourcing/releases/tag/0.14.0) for desktop or Android. Source: [an1uk/obsidian-reseller-sourcing](https://github.com/an1uk/obsidian-reseller-sourcing). The plugin is not yet listed in Community Plugins.

## Start in the workspace

Enable Reseller sourcing, then use its store ribbon button or **Reseller sourcing: Open Home**. The native **Sourcing workspace** has four destinations: Home, Places, Outings and History. Desktop uses a navigation rail; Android uses a bottom bar. It opens when requested and keeps the rest of your Obsidian workspace available.

Home offers one main action: **Add your first place**, **Continue outing**, **Continue planning**, or **Choose where to go**. **Record a visit** and **Find a place** are quieter shortcuts. **Saved for later** holds drafts and other plans. **Not now** removes a preparation from the prominent position without deleting it. Nothing resumes automatically.

**More** contains capture review, examples, help, settings and template maintenance. Records open inside the workspace; **Open note** opens their Markdown files. Filters, expanded sections and scrolling stay local to each pane and device.

## Plan and use an outing

1. **Choose places:** start with an area or shortlist, then select from a searchable list or map. No outing name is required.
2. **Review journey:** check stops and parking. Preferred parking is reused where valid; unresolved alternatives require a choice. Manual ordering and **Improve journey** are optional.
3. **Ready to go:** review the itinerary, optionally edit its generated name, then **Start outing** or **Save for later**.

Back keeps progress. Meaningful preparation changes save after a short pause and flush on close or backgrounding. Saving, saved and failed states are shown. Interrupted completion uses durable receipts so retrying does not create another outing.

For a familiar route, choose **Repeat outing** on a finished outing. It prepares a fresh plan with new stop identities, today's date and reviewed parking. Previous visits stay in the finished outing. Missing or closed places and changed parking are flagged for review. Date-specific opening-hours overrides are cleared; current captured hours are used when reviewing the journey.

**I have about an hour**, on Home or Outings, offers one small, editable suggestion. Choose a saved starting point or enter coordinates, then review the date, departure time, timezone and available minutes. It defaults to 60 minutes, up to three sources and 20 minutes per visit, with return to start off. Area and shortlist are optional filters. Driving suggestions require linked parking with usable pins; excluded places and uncertain hours are explained. Estimates use the existing local planner. Previewing creates no outing; **Use suggestion** continues in the ordinary saved preparation. Closing keeps the short-trip draft, including incomplete input. The front of the form keeps Starting point and Available time, with presets; the visible summary states the date, departure time, timezone and assumptions. Adjust contains filters and advanced choices. Remember these choices is optional and applies only after a reviewed handoff; entered coordinates are never remembered. New defaults do not overwrite saved preparations.

**Out and about** offers an optional focus view for active outings: one current shop, one saved reminder and the relevant direction or recording action. Stages change only when you choose. Confirm parking explicitly, walk between shops sharing it, and return to the confirmed car location before driving on. Opening Maps does not advance a stage. More keeps the full outing, stage choices and recovery controls available.

Active outings lead with the current stop, directions and **Record visit**. Saving a visit returns to the outing. Stops can also be skipped or marked visited without notes; finished outings retain their visit history.

**Catch up on visits** is available after visiting stops, including after finishing the outing. It lists only visited stops and shows their saved quick notes and purchase counts. Add or edit one visit at a time through the normal editor; saved dates remain editable and late entries suggest the original stop date in the outing timezone. Unknown purchases remain distinct from zero. Closing keeps unfinished input, and saving returns to catch-up. Pending and skipped stops remain in the ordinary outing view.

The optional local planner defaults to **Fit opening hours**, **20 minutes per source**, **miles**, and finishing at the last source. Return to start is optional. It supports a start, date, departure time, timezone, endpoint, deadline and per-source overrides. Suggestions use straight-line estimates and recognised weekly hours. They require review and are not optimal road routes or live traffic calculations.

Google Maps export previews retain every selected destination, including shared parking and endpoints. Android app, desktop and mobile-browser profiles target nine, ten and four destinations respectively, subject to Google's URL-length limit. Larger journeys split into numbered parts continuing from the preceding endpoint. Receiving handlers can behave differently; review each imported route. See [validation and limitations](VALIDATION.md).

## Places, visits and history

Manual place creation requires only a **name**. Area, location and other details can follow. Unassigned places remain visible. Source type defaults to Charity shop and is configurable; an explicit selection takes precedence, and changing the default is opt-in.

Places provides a sortable table in wide panes and compact cards with a Sort control on phones. Click a column heading to sort by name, area, type, numeric sourcing rating, last visit or shortlist. Search names, addresses, brands and takeaways; filter by area including descendants, type, rating, shortlist, closed status, recorded visits and missing locations. Nearby searches use a saved place, map point or explicitly requested current location, with straight-line estimates and a configurable radius. Current device coordinates are temporary. Table/cards and maps share the same filters, and Plan an outing from these places carries the criteria into selection without selecting stops. **More views** retains Bases tables, grouping, sorting and Google comparisons. A place leads with its assessment, takeaway, latest reminder, **Record visit**, **Directions** and shortlist control. Overview, Map, Visits and Details separate everyday actions from contacts, organisation and captured details.

Visit forms keep source, editable visit date, items purchased and quick note visible. Blank purchases means unknown; zero means nothing bought. Haul details, stock colours, finds, reminders and assessment updates are expandable. **Save visit** records the entry; **Close** leaves its draft saved. Recording a visit does not clear the shortlist or silently change the current assessment. Tap Unknown or 0, 1, 2, 3 for purchase counts, or More for a number; Undo count reverses the last shortcut within the form. Recent branch stock-colour buttons preserve the recorded meaning/confidence. These controls edit the draft; Save visit remains explicit.

History offers All visits, This week, Previous week and Custom dates, with Monday–Sunday weeks. Insights compares visits, purchases, whole-haul potential and stock-colour observations. Small samples and uncertainty remain visible; stock colours are observations rather than predictions. Sourcing ratings are **0 = unrated** or **0.5–5** in half-star steps, separately from Google ratings.

**Edit place** edits personal names, type/brand, address, location, contacts, opening notes, assessment and parking details. Close retains an unfinished draft; **Save place** explicitly applies the changes. Conflicting edits are reported while your input is kept. A personal display name stays separate from Google names, filenames and review refreshes. Captured Google snapshots remain reviewable through capture refresh. **Edit notes** opens the original Markdown for prose; edits preserve unrelated note content.

## Maps and parking

Free OpenFreeMap backgrounds use OpenStreetMap data with visible attribution. Individual Markdown notes show a compact map before navigation links; the workspace Overview includes the same focused map. Missing coordinates offer Add location; a closed place retains its own labelled pin. Detail maps show the selected place and associated parking. Place maps start close up; area maps fit their pins with padding. Marker taps open persistent popups. Coordinate and saved-camera actions are available. Location is requested only after an explicit action and stops when the map closes or the app backgrounds. Map failures offer retry while records remain usable.

A parking location can serve several sources, and a source can have several alternatives. Link parking or place a new pin from a source map. Choose a preferred location or select one for an outing. Driving shows the selected parking destination; walking targets the source. Missing parking coordinates do not silently become shop coordinates.

## Google Maps capture and refresh

Desktop Obsidian Web Clipper templates are **v0.4.2**: **Source v0.4.2 — Google Maps** and **Parking v0.4.2 — Google Maps**. Open **More → Web Clipper templates** for export/import instructions. The plugin cannot silently replace templates inside a browser extension. Android provides desktop-capture instructions and copyable paths.

Clip an individual listing. Missing fields remain blank; map-centre coordinates are never treated as the destination. Capture review requires a town and permits an optional locality, with supported address suggestions and editable remembered hints. Saving creates any required areas; cancelling creates none. Browser extraction can change when Google changes its page structure.

A fresh source capture matching an exact saved listing or canonical Google identity opens **Review source updates**. Review name, URL, address, contacts, hours, score/count snapshot, topics and validated coordinates. Nonempty changes are preselected; coordinate changes are unchecked. Missing data cannot erase existing values. Personal assessments, visits, parking, prose, filenames and area remain unchanged. Cancelling leaves a capture pending; **Keep existing and archive capture** explicitly dismisses it. Parking refresh is outside this version.

## Portable records and fictional examples

The configurable notebook folder defaults to **Reseller sourcing**:

```text
Home.md                          Workspace launcher
Places/Exampletown/Area.md        Town record
Places/Exampletown/Riverside/     Sources, parking and optional child area
Places/Unassigned/               Places awaiting organisation
Visits/YYYY/MM/                  New visits organised by actual visit date
Outings/YYYY/MM/                 Dated outings
Capture inbox/                   Web Clipper destination
System/                          Views, templates, processed captures and recovery
Examples/                        Isolated practice notebook
```

Editing a historical visit date preserves its existing path. Markdown stays readable without the plugin; interactive controls require it.

**Add examples**, under More or settings, installs example pack **v5** on request: **24 fictional sources, eight parking locations, three towns, six localities, 40 visits, four outings and six prepared captures**. All observations, reviews and contacts are invented. Practice actions use isolated drafts, preferences and receipts. Fictional external actions preview their destinations instead of opening them.

The optional Guided tour can be deleted independently. Deleted example records or the entire Examples folder remain deleted across reopening, repairs and updates. Existing example packs are not rewritten or automatically restored. Earlier pack versions remain available only for explicitly continuing an interrupted installation.

## Build and install

For the ready-to-install package, download **charity-sourcing-0.13.0.zip** from the [release page](https://github.com/an1uk/obsidian-reseller-sourcing/releases/tag/0.13.0). The same release also provides **main.js**, **manifest.json** and **styles.css** separately, plus **release-checksums.json** with SHA-256 hashes. Desktop and Android use the same files. Follow the manual installation steps below.

Use **Node.js 22 or newer** and npm:

```sh
git clone https://github.com/an1uk/obsidian-reseller-sourcing.git
cd obsidian-reseller-sourcing
npm ci
npm run lint
npm run package
npm test
```

`npm run package` type-checks and builds the plugin, then creates a universal ZIP, standard release assets and checksums in `dist/`. `npm run build` builds without packaging. Generated files and dependencies are excluded from Git.

Source checks use the official Obsidian ESLint and Stylelint configurations, with explicit type-safety checks and zero-warning gates. CI runs with read-only permissions on source changes and pull requests. Only version-tag pushes can attest and publish; the standard release contains the exact five verified build assets. To verify a downloaded asset with GitHub CLI, run `gh attestation verify <file> --repo an1uk/obsidian-reseller-sourcing`. The ZIP and checksums are conveniences for manual installation; Obsidian installs only `main.js`, `manifest.json` and `styles.css`.

Desktop and Android use the same plugin ID **charity-sourcing**, version, and three assets: **main.js**, **manifest.json**, **styles.css**. Minimum Obsidian version is **1.14.4**. No separate Android build or APK is needed.

For manual installation, close Obsidian, extract the ZIP's `charity-sourcing` folder into your vault's `.obsidian/plugins/`, reopen Obsidian and enable **Reseller sourcing** under Community plugins. Alternatively, copy the three assets from `dist/release/` into that folder. On Android, use a file manager with access to the vault. Back up an existing installation before replacing its three assets, and preserve its `data.json` settings file. Start with a separate test vault while evaluating this early release.

The portable test suite skips three optional integration checks unless `CLIPPER_TEST_HARNESS_DIR` points to a locally supplied harness for the installed Web Clipper/compiler and native Bases formula integration. That harness is not distributed here. The remaining tests do not require it. See [VALIDATION.md](VALIDATION.md) for the distinction between portable tests and historical native/device acceptance.

To attach an already-synced notebook on another device, let your existing sync method finish, then choose **Use existing notebook** in setup. Inspection is read-only; explicit attachment saves local settings without repairing or rewriting notes. The plugin includes no sync transport. Desktop folder and Chrome actions are guarded and unavailable on Android.

## Access and privacy

Routine browsing traverses the selected notebook. Explicit notebook attachment discovers candidate notebooks, and reviewed moves inspect relevant vault links to preserve backlinks and recovery. Clipboard copying occurs only after a user chooses a Copy action. The plugin writes the selected text; it never reads clipboard contents. If copying is unavailable, it provides selectable text instead.

## Credits and licence

This project is MIT licensed; see [LICENSE](LICENSE). The map implementation is adapted from **Obsidian Maps 0.2.2**, MIT © 2025 Obsidian, pinned at `8703e98013fa20fb188746d24664452f41b17227`. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), [licenses/UPSTREAM.md](licenses/UPSTREAM.md) and the plugin's About / Credits.

MapLibre and runtime dependency notices are packaged. Complete licence texts are embedded in `main.js` and readable/copyable in About / Credits, including a three-file installation. OpenFreeMap, OpenMapTiles and OpenStreetMap attribution is retained.
