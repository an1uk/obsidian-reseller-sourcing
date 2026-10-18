# Map source and acknowledgements

Reseller sourcing adapts Obsidian Maps 0.2.2 by Obsidian, copyright 2025 Obsidian, under the MIT licence. Its map rendering, Bases integration, marker and popup managers, styles, controls, coordinate utilities and Mapbox URL compatibility code are copied and modified in `src/map/`.

- Source: https://github.com/obsidianmd/obsidian-maps
- Release: https://github.com/obsidianmd/obsidian-maps/releases/tag/0.2.2
- Pinned commit: `8703e98013fa20fb188746d24664452f41b17227`
- Annotated tag object: `a1283feba88991e59c5aab74e475ea4c75278f87`
- Full licence: `obsidian-maps-MIT.txt`

Modifications: a distinct Bases view type and CSS namespace; root-scoped data; automatic locality framing with larger padding and a Fit all control; embedded place maps and touch pin placement; reviewed parking creation and coordinate changes; lifecycle guards; explicit map attribution; and plugin host callbacks instead of the original standalone Maps plugin.

MapLibre GL JS 6.14.0 is bundled under its BSD 3-Clause licence (`maplibre-gl-BSD.txt`). This updates the renderer beyond the upstream Maps dependency to include its security fixes. The bundled Mapbox RTL text plugin 0.3.0 uses the BSD 2-Clause licence with its included ICU permission notice (`mapbox-gl-rtl-text-BSD.txt`). Dependency licences are shipped with the local package.

Default map styles and tiles are provided by OpenFreeMap (https://openfreemap.org/), using OpenMapTiles and OpenStreetMap data. Maps retain visible attribution links to OpenFreeMap, OpenMapTiles and OpenStreetMap contributors. OpenStreetMap data is licensed under the Open Database Licence: https://www.openstreetmap.org/copyright. Custom providers can carry their own attribution and terms.

These acknowledgements do not imply endorsement of Reseller sourcing by Obsidian, MapLibre, Mapbox or the map-data providers. Project source is available at https://github.com/an1uk/obsidian-reseller-sourcing.
