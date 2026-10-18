# Examples feature inventory - 0.11.0 candidate

Internal maintenance inventory. Working examples exercise production controls through an isolated NotebookContext. Illustrations describe another environment or exceptional state; they do not claim physical, browser, sync or failure acceptance.

| Feature | Coverage in Examples | Mode |
|---|---|---|
| Clear Home and consistent navigation | Native workspace, one starting action, Saved for later and More; example background outings do not take over Home | Working |
| Search, tables, grouping and sorting | Places List/Map, area screens and two advanced scoped Bases; brand, type, town and review comparisons | Working |
| Short visit flow | Date, items purchased and quick note first; saved extra details reopen expanded; draft and outing routes remain explicit | Working through the same production forms |
| Weekly visit history and folders | Forty visits in Visits/YYYY/MM across August, September and October 2026; Monday-Sunday browsing, custom dates across month boundaries; comparisons in Insights | Working |
| Source types and branches | 16 charity shops, 3 rag houses, 2 wholesalers, 2 markets and Community reuse depot; repeated brands | Working |
| Ratings and sourcing judgement | Unrated and half steps; sourcing colours independent of contrasting Google snapshots | Working |
| Shortlist, closure and incomplete information | Shortlisted sources, closed historical branch, two unpinned sources, eight unvisited records | Working |
| Separate visits | 40 editable visit notes across 16 sources: one focal source with 10, 15 sources with 2, 8 sources unvisited; actual versus recorded dates, distinct observations and explicit last visited | Working |
| Legacy inline history | Existing v1/v2 payloads unchanged; Reference/Legacy visit history shows retained source prose beside a new separate record, without inferring fields or offering conversion | Worked before/after illustration |
| Weekday comparison | Focal source has five Mondays (counts 2, 3, 2, 4, 3; mean 2.8, median potential 3) and five Fridays (6, 5, 7, 4, 8; mean 6, median 4); backdated Monday recorded Saturday | Working through Visits/insights and source controls |
| Counts and haul potential | Zero versus unknown counts, missing haul score, few strong items and many weak items; whole-haul 1–5 integers independent from source rating | Working |
| Stock-colour evidence | Five weekly Blue/Green/Blue/Green/Blue runs, confirmed on both days; Blue two 14-day observed returns, Green insufficient recurrence; unchanged sightings, suspected/unknown labels and same-date conflicts | Working; retrospective evidence, no stock prediction |
| Contacts and Google details | Invented website/telephone, structured hours, dated review pairs/topics, missing fields; edit controls | Working; external destinations preview |
| Pin editing and map camera | Source/parking maps, scoped Base camera save, location omission, area clusters | Working; real tile background |
| Parking | Eight free/paid/on-site/unreliable locations; sharing, alternatives, preferred choice and missing parking pin | Working |
| Areas and hierarchy | Three fictional towns and six localities; inline area creation, Change area, parent moves and rollback | Working |
| Defaults and remembered address phrases | Independent practice defaults and editable hints in Settings | Working |
| Distance units | Main and practice settings independently select miles (default) or kilometres; planner speeds use mph or km/h; saved physical values remain metric | Working; unit switches preserve precision |
| Local planner | Two current planned outings include starts, a last-source finish, an explicit return, visit durations and dated hours overrides; Plan journey compares local estimates and schedules | Working; road/traffic claims excluded |
| Larger Google Maps routes | Android, Desktop and browser profiles, full destination lists, return endpoints and numbered overflow parts | Working selectable previews; receiving-device capacity verified separately |
| Outings | Two planned, one active, one finished; shared parking, ordered/skipped/visited stops, opening hours, one finished stop with a detailed visit link, visited without details, unfinished visit draft, multipart previews | Working |
| Capture creation | Complete and incomplete prepared v1/v2 raw clips; explicit review and saving | Working; no browser extraction |
| Source refresh | Complete, partial, older and already-current prepared clips; selected fields, unchecked pin, keep/archive | Working; exact fictional listing identity |
| Raw evidence and receipts | Verified original archives for all sources; new review receipts and practice recovery state remain inside Examples | Working |
| Source/parking navigation and contacts | Listing, drive, walk, website, telephone and multipart route destinations | Working selectable previews; no handlers |
| Optional guide | Guided tour links to existing records; no automatic opening or feature gates | Working; deletion independent |
| Setup, generated ownership and customised components | Reference/Setup and ownership, before/after trees | Worked illustration; no real setup invoked |
| Notebook root moves | Reference/Organisation before and after; existing pack/state/raw evidence carried by real root migration | Worked illustration plus automated migration regression |
| Attachment and second device | Reference/Attachment and sync, before/after | Worked illustration plus isolated attachment regression |
| Clipper installation and updates | Reference/Web Clipper and platform boundaries; desktop exports stay v0.4.2 | Worked illustration; real browser import separate |
| Recovery and concurrent edits | Reference/Recovery and raw evidence, before/after; active outing draft | Working draft and normal safeguards; injected failures automated |
| Sync transport | Reference/Attachment and sync | Worked illustration; real round trip outstanding |
| Map resilience, location permission and lifecycle | Reference/Navigation and map behaviour; current map controls retained | Working controls; exceptional states verified separately |
| Licensing and platform setup | Existing About/Credits and Reference/Web Clipper and platform boundaries | Existing real plugin dialog; practice setup points to Reference |

Isolation acceptance: shared operation coordination, stable context-bound forms, independent preferences/receipts, real readers exclude example flags and paths, cross-context associations rejected, outside backlinks block practice moves, deleted context invalidates stale saves. Installation is explicit, resumable and nonoverwriting. Ordinary repair, updates and attachment do not install or restore any example content.

Historical packs 1, 2 and 3 retain exact 113/114/158-file hash fixtures and support explicit interrupted continuation. Pack 3 keeps its original flat separate-visit files and earlier hubs. Pack 4 adds year/month visit folders, the history-first Visits hub and calm everyday workflow examples. Ready older packs are never augmented or reorganised; deleting a visit, the optional tour or the whole context stays permanent. Current runtime controls improve without rewriting existing example notes.

Dataset counts, exact weekday/colour statistics, outing links and capture behaviours are asserted by tests/examples-pack.test.ts; storage/migration/deletion boundaries by tests/examples-storage.test.ts; UI ownership and retained drafts by tests/notebook-ui-context.test.ts. Native scripts/runtime-examples.mjs exercises real/example panes and narrow layouts. Current measured release evidence belongs in VALIDATION.md.




Pack v5 adds the native workspace, three-stage preparations, name-only Unassigned creation and durable draft controls. Places combines source, parking and area records; visits and outings use year/month folders. Fresh Examples Home offers Choose where to go. Prepared unfinished work stays under Saved for later. Capture archive and Guide move inside System; raw capture bytes remain immutable. Pack v4 is frozen against the independently installed 0.10.0 hash manifest. Tests/workspace-storage.test.ts covers the new structure, CAS drafts, completion retries and draft link moves.
