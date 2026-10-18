# Third-party notices

Charity Sourcing is a local development plugin. The following acknowledgements and bundled licence texts must accompany redistributed packages. Names and links identify sources; they do not imply endorsement.

## Obsidian Maps

The map implementation is adapted from **Obsidian Maps 0.2.2**, copyright 2025 Obsidian, under the MIT licence. The pinned source commit is `8703e98013fa20fb188746d24664452f41b17227`.

- [Pinned source](https://github.com/obsidianmd/obsidian-maps/tree/8703e98013fa20fb188746d24664452f41b17227)
- Complete licence: `licenses/obsidian-maps-MIT.txt`
- Source and modification record: `licenses/UPSTREAM.md`

Copied and modified map code covers Bases integration, styles, marker/popups, controls, coordinate utilities, RTL loading and Mapbox URL compatibility. Changes introduce a separate view type, sourcing-note integration, shared parking, reviewed pin placement, locality framing and larger padding, lifecycle handling, map attribution, and the newer MapLibre renderer. The Maps community plugin itself is not required.

## Bundled libraries

| Component | Version | Licence / notices |
| --- | --- | --- |
| MapLibre GL JS | 6.14.0 | BSD-3-Clause; `licenses/maplibre-gl-BSD.txt` |
| Mapbox GL RTL text | 0.3.0 | BSD-2-Clause plus ICU/Unicode permission notice; `licenses/mapbox-gl-rtl-text-BSD.txt` |
| YAML | 2.9.1 | ISC; included under `licenses/dependencies/` |

The package script copies the installed runtime dependencies' licence/copyright/notice files and records their exact versions in `licenses/dependencies.json`. This includes MapLibre's transitive dependencies and YAML, which is bundled at build time. Any build-generated legal notices are retained as `licenses/bundle-legal-notices.txt`.

Obsidian is an external host and is not included in the package. The Obsidian API typings are used for development only. Development tools are not included in the installable package.

## Map data and services

Default map backgrounds are served by [OpenFreeMap](https://openfreemap.org/) using [OpenMapTiles](https://openmaptiles.org/) and [OpenStreetMap data](https://www.openstreetmap.org/copyright). Visible attribution remains on the maps. OpenStreetMap data is licensed under the Open Database Licence; this is separate from the software licences above. Custom map sources may impose their own terms and attribution requirements.

Google Maps is an external capture source and navigation destination. No Google Maps API key or paid API is used. The browser's existing Obsidian Web Clipper handles selected-page capture; this package does not bundle or modify the extension. No Google review text is harvested.
