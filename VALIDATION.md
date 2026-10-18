# Validation: Reseller sourcing 0.11.1

One shared desktop/Android plugin, ID **charity-sourcing**, requiring Obsidian **1.14.4** or newer. Clipper templates remain **v0.4.2**. This document distinguishes repeatable public-tree checks from historical native and physical acceptance. Private captures, screenshots, device details, vault paths and test harnesses are not included in the repository.

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

Interactive Chrome capture, real desktop–Android notebook sync, repeated live Google Maps destination-capacity tests and location-permission flows remain outstanding. Phone checks above cover the 0.11.0 workspace and do not establish every browser, handler or device configuration. Google Maps export profile limits are targets rather than a guarantee that every receiving handler accepts the full route; review imported destinations before travelling.

The [0.11.0 release](https://github.com/an1uk/obsidian-reseller-sourcing/releases/tag/0.11.0) provides the shared desktop/Android assets, universal ZIP and SHA-256 checksums. It is published as a standard GitHub release, with its early-development status described in the README. It is not a Community Plugins submission. Device-specific acceptance drivers, deployment helpers and private evidence remain local and are not required for the public build.
