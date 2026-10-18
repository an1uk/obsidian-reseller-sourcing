Reseller sourcing 0.11.1 is an early release for desktop and Android.

- Searchable, grouped settings preserve existing controls and roll back failed saves.
- Validated data boundaries and a typed notebook context preserve drafts, recovery and real/example isolation.
- Scoped CSS and a bounded touch popup replace the mobile style overrides. Copy fallbacks remain selectable.
- Routine browsing stays within the selected notebook. Right-to-left map text uses MapLibre's built-in support.
- Official Obsidian source/CSS checks and portable tests run in read-only CI. Trusted version tags attest all five downloads before publication.

Desktop and Android use the same `main.js`, `manifest.json` and `styles.css`, requiring Obsidian 1.14.4 or newer. The ZIP and SHA-256 checksum file remain available for manual installation. Clipper templates remain v0.4.2; no re-import is required.

This is a standard release. See [validation and remaining acceptance](https://github.com/an1uk/obsidian-reseller-sourcing/blob/0.11.1/VALIDATION.md) for test scope and known limits. No notebook-schema migration is required. Release 0.11.0 remains available.
