# Validation: Reseller sourcing 0.14.0

One shared desktop/Android plugin, ID **charity-sourcing**, requiring Obsidian **1.14.4** or newer. Clipper templates remain **v0.4.2**. This document distinguishes repeatable public-tree checks from historical native and physical acceptance. Private captures, screenshots, device details, vault paths and test harnesses are not included in the repository.

## 0.14.0 verification

On 21 October 2026, source/CSS lint, type checking, the production build, packaging and licence checks passed. The portable suite completed 682 tests: **679 passed, zero failed and three optional integration checks skipped**, as described below. Frozen historical example outputs remained unchanged. No runtime dependency or browser-template change was needed.

**13 isolated native Obsidian scenarios passed**, including three full process restarts for raw short-trip input, unfinished visit details and the parked-car anchor. They covered optional focus stages, explicit parking/arrival choices, shared-parking walking, final return, reviewed journey handoff, practice-only remembered defaults, unknown versus zero purchases, count undo and recent branch-colour shortcuts. Thirty-six narrow light/dark layouts included simulated keyboard heights. A final stylesheet repeat verified all three journey footer labels and reachable actions across 12 width/theme/keyboard configurations after correcting narrow text wrapping. The unrelated vault/configuration guards remained unchanged. These are scoped functional and layout checks, not an accessibility certification.

**Twelve physical Android workflow scenarios completed** in a separate test vault over Wi-Fi debugging. Nine passed in the initial run; after correcting a test-only wait for asynchronously loaded form fields, the final three continued from the verified existing draft without replaying earlier saves. Checks covered the two-choice short-trip form, invalid input across cold reopening, explicitly selected parking, reviewed handoff, practice-only defaults, optional focus/manual stages, fictional direction previews, purchase shortcuts and Undo, native numeric/text entry, branch colours without inferred confidence, keyboard-open actions in light/dark themes, restored visits saved once, shared-parking walking, zero-purchase visits, final car return, explicit finishing and completed results after cold reopening. All 198 pre-existing notebook files and personal preferences were preserved; new test records remained inside Examples.

The three installed phone assets were pulled back and matched the packaged hashes. Desktop installation used a verified outside-vault backup and compared 4,703 vault files: all 145 notebook files and personal plugin preferences were unchanged. Only plugin package files changed. Source/diff and unpacked-asset privacy checks found no private identifiers in the new public changes. Release assets are produced by the tag-only verification and attestation workflow.

Interactive Chrome capture, real notebook sync, live Google routing capacity and location-permission checks remain outstanding. These checks do not establish every Android device or external handler. Results below the 0.13.0 heading describe the earlier published release.

## 0.13.0 verification

On 20 October 2026, source/CSS lint, type checking, the production build, packaging and licence checks passed. The portable suite completed 626 tests: **623 passed, zero failed and three optional integration checks skipped**, as described below. Frozen historical example outputs remained unchanged. No runtime dependency or browser-template change was needed.

**12 isolated native Obsidian scenarios passed**, with no console errors and an unchanged unrelated-vault/configuration guard. They covered repeat-outing history preservation, short-trip preparation and draft restoration, reviewed handoff without an automatic outing save, catch-up additions and edits without duplicate visits, original dates and finished status, and real/practice isolation. Layout checks used 360/390/420 px in light/dark themes, including simulated open-keyboard heights and reachable footer actions. These are scoped functional and layout checks, not an accessibility certification.

The final native run exercised immediate Add-to-Edit catch-up actions across passive redraws. Its JavaScript, manifest and stylesheet hashes are checked against the local package before installation. The guarded installation preserves existing notebook files and personal preferences; updates to generated help are available to new notebooks or through explicit repair rather than rewriting this notebook during installation.

**13 physical Android workflow checks passed** over Wi-Fi debugging in a separate test vault: the 12 outing-workflow scenarios plus native text entry, Close-retained input, draft resumption and explicit saving. Checks covered invalid short-trip drafts across cold reopening, saved parking selection, reviewed suggestions without automatic creation, fresh repeated outings, retained original history, unknown versus zero purchases, original visit dates, immediate catch-up edits without duplicate visits, and saved results after reopening. Short-trip and visit actions remained reachable with the real Android keyboard open in light/dark themes.

Physical marker taps, persistent popup actions, fictional listing previews and explicit dismissal also passed. The three installed assets were pulled back and matched the exact native-tested/package SHA-256 hashes. Installation preserved existing notes, settings and saved work. Test mutations stayed inside fictional Examples; pre-existing records and personal preferences remained unchanged apart from expected practice coordination state. No runtime code change was needed for this acceptance pass.

Interactive Chrome capture, real notebook sync, live external-routing capacity and location-permission checks remain outstanding for this release. These scoped physical checks do not establish every Android device or external handler. Results below the 0.12.0 heading describe the earlier published release.

## 0.12.0 verification

On 20 October 2026, the exact staged public tree was exported into a clean directory, installed from its lockfile, and verified without private development drivers. Official source/CSS lint and type checking passed. The portable suite passed **557 tests with zero failures**, with the same three optional integration skips described below. Packaging retained all required runtime licence notices, and the production dependency audit reported zero vulnerabilities.

**20 native place-workflow scenarios passed** in an isolated desktop vault: source and parking maps in Reading view and Live Preview, closed and missing pins, numeric column sorting, combined filters, list/map parity, explicit nearby references, outing criteria with no automatic selections, durable edit drafts, validation, concurrent prose, conflict choices, reversion persistence and live overview refresh. **Three final stylesheet scenarios passed**, covering 360/390/420 px light/dark cards and focused coordinate entry at keyboard height. Tested JavaScript and manifest bytes matched the final package; the layout repeat used the final stylesheet.

The existing **14 native workspace scenarios** and **five settings/pop-out scenarios** also passed. Three additional native organisation-handoff checks verified draft preservation, released editing guards and unchanged records. The unrelated vault snapshots remained unchanged. These checks are scoped functional and layout acceptance, not an accessibility certification.

Eight physical Android scenarios passed in a separate test vault over Wi-Fi debugging: all four source/parking Reading and Live Preview map combinations, map panning and popup dismissal, fictional destination previews, phone filters/sorting/Nearby without automatic location requests, keyboard-open coordinate entry with reachable save controls, retained drafts, explicit contact/name/pin saves, context isolation and cold reopening. The canonical installation preserved 158 notebook text files, preferences and saved work, with all three installed assets verified by SHA-256.

A final three-scenario physical check against the released build verified area/parking handoffs, draft retention, cold reopening, maps and reachable keyboard save controls. The final installation preserved 159 notebook files, preferences and saved work, and its three asset hashes were verified again.

Physical conflict-review acceptance, interactive Chrome capture, real vault synchronisation and live Google routing-capacity checks remain outstanding. Conflict review passed the isolated native desktop tests. Source checkouts use canonical LF line endings so fresh Windows and Linux builds can reproduce the same three plugin files.

## Portable checks

With Node.js 22 or newer, run:

```sh
npm ci
npm run lint
npm run package
npm test
```

Packaging includes type checking, a production build, the universal ZIP, three standard release assets, SHA-256 checksums and third-party notices. Complete runtime licences are embedded in the build and available in About / Credits.

Three tests are optional and normally skip: installed Clipper import/selected-panel extraction, selected-listing contacts, and native Bases descendant-area filters. They require a separately supplied local harness selected by `CLIPPER_TEST_HARNESS_DIR`. The harness contains integration routines from separately installed applications and is not distributed with this project. A passing portable suite does not imply those integrations or interactive browser capture have been tested.

For 0.11.0, the reviewed public source was exported into a clean directory and verified with Node.js 22.23.3 on Windows: 478 tests passed, zero failed and the three optional integration tests skipped. No excluded acceptance or deployment files were needed.

## Community-review corrections in 0.11.1

The source and scoped CSS use the official Obsidian lint configurations, with explicit unsafe-assignment/call/member/argument/return and redundant-assertion rules. CI treats warnings as failures. Tests cover searchable settings, failed-save rollback, malformed data, incomplete drafts, concurrent edits, custom configuration directories, owner-window DOM handling and context isolation. Frozen historical example outputs remain covered by their recorded byte hashes.

Pull requests and source changes run read-only CI. Only an exact version-tag push in this repository can enter the separate attestation and publishing jobs. Every one of the five downloads is attested, and the publisher verifies its workflow identity and source commit before creating a standard release. The three standard plugin files, manual-install ZIP and checksum document are built once and retain those bytes through publication.

Vault discovery and user-initiated clipboard writes remain necessary capabilities. They are documented in the README. ZIP/checksum downloads are optional conveniences and are not installed by Obsidian. Their presence may continue to produce an extra-files recommendation in Community review.

On 18 October 2026, the 0.11.1 portable suite passed **500 tests with zero failures**, plus the three optional integration skips described above. Lint, type checking, packaging and licence checks passed. Historical example byte manifests remained unchanged. The production dependency audit reported zero vulnerabilities. Development lint tooling inherits advisories in its upstream tooling dependencies; these are not bundled in the plugin.

Five isolated native review/control checks passed against Obsidian 1.14.4: side-effect-free settings indexing, failed-save rollback followed by successful refresh, native settings search, a separate pop-out window retaining its search text and a plain Markdown pop-out control. Owner-window events and caret restoration during redraw are covered separately by portable tests.

All 14 workspace acceptance scenarios also passed against the final 0.11.1 build, including 360/390/420 px light/dark layouts, preparation resumption, parking choices, planning, visits, capture cancellation and cold reopening. They ran in an isolated desktop vault and verified the unrelated vault snapshot remained unchanged.

Physical Android checks in a separate test vault covered native marker taps, bounded persistent popups, scrolling/dismissal, fictional navigation previews, light/dark keyboard-open visit forms, saved drafts and selectable-text fallback after clipboard denial. The final downloaded release files are verified separately before acceptance. These scoped checks do not establish every external-handler or sync scenario.

## Historical automated and desktop acceptance

Before public-source preparation, **481 tests passed, with zero failures or skips**, using the optional local Web Clipper and Bases harness. Type checking and production build also passed. The harness uses compiler routines and synthetic page fields; it is not interactive Chrome acceptance.

Coverage includes notebook paths, route validation, quick creation, collisions, preparation saves, Not now, stale panes, deletion, failed writes, malformed records, interrupted completion without replay, concurrent prose, context isolation, links following moves, capture refresh, visits, planning, route export, attachment, Android module loading, clipboard fallbacks, licensing and frozen example generations.

**14 isolated native desktop workspace scenarios passed** against the final mobile-popup correction. They exercised empty Home, name-only places, quick/zero-purchase visits, retained drafts, the three outing stages, start/record/return, examples in a second pane, retained search, Open note, maps, shared parking, planner defaults, weekly history/Insights, capture-refresh cancellation and cold reopening. Narrow **360, 390 and 420 px** layouts were checked in light/dark themes for horizontal overflow and navigation targets of at least **44 px**. Test-vault and configuration preservation checks passed.

These are scoped acceptance checks rather than an accessibility certification. The workspace follows [W3C guidance on maintaining focus](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o5-user-focus/).

## Historical physical Android acceptance

An initial six physical scenarios passed in an isolated test vault. Native taps and keyboard input covered plugin loading, empty Home/bottom navigation, name-only creation, zero-purchase visits with the keyboard open, close-preserved drafts, outing preparation/resumption/Not now, free map tiles, markers, weekly browsing and Insights.

**Eight final physical continuation checks passed** after installing and verifying the final shared release assets. They covered:

- Saved outing preparation, start, visit recording and return to the outing.
- Zero-purchase values and drafts surviving cold reopening.
- Light/dark layouts, keyboard-open saving and close-preserved input.
- Persistent map popups, destination previews, explicit dismissal, pan and Fit all.
- Tap-to-place parking cancellation without creating a record.
- Home navigation without horizontal overflow and touch targets of at least 44 px.
- Real/practice isolation and unchanged unrelated test records/preferences.
- Pulled-back installed assets matching the packaged SHA-256 checksums.

Physical testing identified toolbar overlap and an oversized popup hiding navigation actions. The workspace reserves space above Obsidian's mobile controls, and touch popups are bounded with scrollable content and a close control. Both corrections were retested. Inline workspace popups open the place through its title; Bases popups provide the explicit Open note action.

## Remaining acceptance

Interactive Chrome capture, real desktop–Android notebook sync, repeated live Google Maps destination-capacity tests and location-permission flows remain outstanding. Historical phone checks cover earlier workspace releases and do not establish every browser, handler or device configuration. Current-version acceptance is identified separately above. Google Maps export profile limits are targets rather than a guarantee that every receiving handler accepts the full route; review imported destinations before travelling.

The [0.11.0 release](https://github.com/an1uk/obsidian-reseller-sourcing/releases/tag/0.11.0) provides the shared desktop/Android assets, universal ZIP and SHA-256 checksums. It is published as a standard GitHub release, with its early-development status described in the README. It is not a Community Plugins submission. Device-specific acceptance drivers, deployment helpers and private evidence remain local and are not required for the public build.
