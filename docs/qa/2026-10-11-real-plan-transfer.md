# Real-plan recognition and 2D/3D transfer audit

## Acceptance scope

Re-extract original PDF source layers, compare them to the visible survey sheet, run one fresh image-model reading without reviewed contours, and replay the application's post-reader gates. Fix reproducible losses or unsafe promotions. Missing geometry, height ownership or floor datum must remain missing rather than becoming an approximate accepted model.

This audit does not use the previous synthetic delivery project as a source-plan recognition test. No account/project records, subscriptions, passwords or source files are changed.

## Actual sources

- Rebrina's published survey: original `output/pdf/source-search-20261003/rebrina-original.pdf`, page 3 / survey sheet 2; SHA-256 `2e141c135812c81719e1f4783173cb5202e20041ac494d3cc799eb37ad62ad4e`. Source reviewed as existing, not the later installation or furniture sheets. Printed measurement/angle uncertainty is not silently treated as zero.
- Apartment 74.77 m2: original `C:/Users/Lenovo/Documents/Codex/2026-09-26/1-pdf-1-2-pdf-3/outputs/apartment_74_77m2_full_project.pdf`, page 6 / survey sheet 03; SHA-256 `d79a89eba7d262f2615a9c9f99c03be4553d85c5f737423c51f98e8c9f5da1ab`.

Original PDFs are not included in Git. Local references and diagnostics are not a licence to publish someone else's full album.

## Reproduced defects and fixes

1. **Unitless height captions disappeared.** On Rebrina, `Н=3790` and nine other literal H captions gave zero height observations despite the same-page note `5. Размеры указаны в миллиметрах`. Extraction and observation selection now share a strict documentary-units rule. Raw H text is unchanged; the note's source/page/native index is retained separately. An unresolved native glyph identity is explicitly unverified, not accepted as ink or model authority. Duplicate, qualified, foreign and conflicting units notes (including metre exceptions) withhold the interpretation. All documentary H values remain unclassified with unspecified datum and no geometry acceptance.
2. **Unrelated legend heading rejected the schedule.** The duplicate `Наименование` in a separate legend no longer excludes one complete, unambiguous three-column source grid. The implementation does not pick the first/nearest heading. Competing valid schedules, damaged grids, unsupported numbering and incomplete rows remain held. Rebrina's `3.1` numbering and merged total are still unsupported, so this particular schedule is not reported as accepted.
3. **A ceiling could belong to another room.** The new 74.77 reading put the literal bedroom ceiling caption `натяжной-2663мм` into the living room's measurement evidence. Text/arithmetic agreement did not prove ownership. The ordinary PDF post-reader gate now clears unowned room and apartment ceiling claims with a specific warning; it does not modify the reader response or substitute an average. The separate reviewed-contour/leader path retains its existing rules.

The UI displays the documentary units note and unresolved glyph identity, without adding a save/confirm action for these observations. Client response validation must agree with the expanded inventory; raw text/source/value/role consistency remains required.

The real component initially rejected the new documentary packet with HTTP-style 422 validation. The client DTO was corrected with bounded source/note/value checks, not an arbitrary-extra-fields fallback. A fresh original-PDF packet and rendered JPEG pass the actual client loader; the browser now displays all ten observations and their unverified status. No save or confirmation authority was added. Browser document width equals viewport width (`1265 px`), without horizontal overflow.

## Fresh observed results

### Rebrina page 3

- 2,124 extracted native paths, 532 clipped paths; 14 fill and 8 stroke candidates.
- Six unproved floor cavities; zero accepted floor boundaries, opening frames or classified windows. Zero door-symbol count is not proof of absent doors: the survey uses wall gaps without swing arcs.
- After the fix: ten documentary H observations, with values `3277, 3773, 3790, 3780, 360, 360, 3790, 2835, 3495, 3790` mm. They include different quantities: beam/rise/structural/room context cannot be inferred from the isolated H string.
- The original units-note glyph-show identity remains unresolved. Height locations, owners and 2D/3D transfer remain held. A finished-floor note does not establish equal floor elevations or a shared zero for every room.

### Apartment 74.77 page 6

- One fresh paid reader request, with native text but **without** reviewed contours. Eight rooms and eight areas matched the source reference. The raw reader got 9/12 known dimensions right, three wrong, and 1/2 individually controlled ceilings right. A value absent from the manual reference is not automatically a false claim; the native post-reader checks are separate.
- The strict parser retained 3/12 known dimensions; production native-chain replay subsequently held all width/depth fields in this response. After the height-owner fix it also holds the four ceiling claims, including the wrongly owned one. Original raw response remains saved separately.
- The application post-reader gate discards the model's metric mesh. No accepted volume is produced.
- Independent transfer control using **manual source-reviewed** contours re-extracted 1,206 paths with 45 skipped curves. It produced a draft of seven zones, 63 wall spans and 19 opening records, with 11 fresh source wall-pairs. This is not automatic recognition. It introduced no measured wall/opening heights or signed floor reference; `planVolume` returned null.
- The legacy exterior envelope annotation is not an independently proved free-floor boundary. Idealized unit fixtures with omitted curves removed and 52 wall-pairs must not be presented as the fresh real-source result.

Provider-reported usage for the single new request: 15,747 tokens and USD 0.123537. This is usage metadata, not an independently verified invoice charge. Replays made no additional paid calls.

## Gate and next work

**BLOCKERS for automatic accepted 2D/3D on these sources:** clipped/curved source completeness, rotated opening/frame support, full physical floor boundary and opening inventory, independent metric supports, object-specific heights, and shared floor/threshold datum. Approximate envelopes or rectangle fallbacks must not close these gaps.

**IMPORTANT:** decimal source-room numbering and split/subscript height captions need explicit source-linked support. A room number, a wall gap, a door swing and a free-floor threshold are different evidence.

**Recommendation:** ship the bounded correctness fixes after regression and UI checks; do not advertise complete automatic 2D/3D recognition for these sheets. Preserve original hashes and before/after evidence when extending the next stage.

Local evidence is under `tmp/real-plan-*20261011*`, `tmp/real-transfer-control-20261011/` and `output/quality-bench/plan-74-77-native-text-real-transfer-20261011/`. These ignored artifacts are not synthetic replacements for the PDFs.

## Regression verification

- Full web suite: 6,821 tests / 300 files passed, including local-only original PDF re-extractions when that ignored source exists. Public CI does not require copyrighted PDFs; deterministic unit controls remain present there.
- Typecheck: seven packages passed. Biome: 988 files passed, changed code formatted. Production build and diff check passed.
- Independent review caught a missed metre-unit exception; it was fixed with negative inventory tests. The reviewed source-transfer path, native floor guards and unsupported/foreign/malformed-source refusals remain intact.
