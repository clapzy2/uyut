# Real-plan recognition and 2D/3D transfer audit

## Acceptance scope

Re-extract original PDF source layers, compare them to the visible survey sheet, run one fresh image-model reading without reviewed contours, and replay the application's post-reader gates. Fix reproducible losses or unsafe promotions. Missing geometry, height ownership or floor datum must remain missing rather than becoming an approximate accepted model.

The offline audit does not use the previous synthetic delivery project as a source-plan recognition test. Those stages changed no account/project records, subscriptions, passwords or source files. The separate live-account follow-up below explicitly records its QA-project writes.

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

### Follow-up: positive paint and arbitrary-angle frame correspondence

Fresh source inspection identified a distinction missed by the cavity-only interpretation:
Rebrina's eight room shapes are positive white paint masks (operations 1462, 1491, 1527,
1563, 1591, 1611, 1631, 1651), already present in the 14 fill candidates. The six union
holes are a column and small mask-overlap slivers, not six missing room floors. Do not
repair those holes and report them as rooms. White paint is not a physical-floor role.

The inspection now references those existing positive polygons separately from negative
space and reports earlier/later different-colour paint and possible omitted-ink bounds.
For example, kitchen mask 1462 intersects the later grey column operation 13501;
the hall mask 1651 already goes around that column. Compound, unknown and omitted paint
remains unresolved. These diagnostics do not certify the final visible fill, room owner,
floor boundary or height owner. No polygons are duplicated or source masks flattened into
an accepted floor. The public packet contains bounded counts, not the full internal contact
inventory. A client regression protects unresolved reports when omission counters exceed
the extractor's separately capped bounds inventory.

Exact source-decimal rectangular opening frames now support arbitrary orientation with
the actual page X/Y raster scale; no floating rotation or angle tolerance alters the
source vertices. Opposed profile contacts and frame/floor-side correspondence use exact
parallelism, collinearity and relative polygon winding rather than horizontal/vertical
bounding-box normals. Repaint aliases and competing frames use source vertices and exact
polygon overlap. Small displaced edges and partial jamb coverage remain held.

**Actual source result:** the original Rebrina page still yields zero opening-frame
candidates. Exact rotated fixtures verify the new angle support, not recovery of this
rounded/incomplete source. Its 14 positive paint shapes are available for visual inspection;
its six unproved cavities and ten unclassified H observations remain unaccepted. No new
AI call or account/project mutation was performed in this follow-up.

Another concrete remaining issue: Boolean-union intersections are rounded Number points
that can fail exact collinearity against both original source edges. The first column-hole
vertex matches a rational crossing numerically, while another differs by approximately
2.84e-14. An epsilon or snap is not a valid repair. Existing rational graph support needs
source-linked local paint-role selection: the whole white graph correctly refuses ambiguous
nearby window intersections. A manually narrowed graph is not automatic recognition.

Verification: 6,859 web tests / 301 files, typecheck seven packages, Biome 990 files,
production build and diff check passed. Independent reviews found and closed the client
omission-counter regression. Actual UI/core with the original PDF and mocked private HTTP
showed the new 14-shape context and unchanged source overlay; viewport/scroll widths were
1265/1265 and 375/375, with no warning/error console logs. This is local component QA,
not real-account authorization/persistence proof. Screenshots are under
`output/playwright/real-plan-positive-regions*20261011.jpg`.

**BLOCKERS for automatic accepted 2D/3D on these sources:** clipped/curved source completeness, rotated opening/frame support, full physical floor boundary and opening inventory, independent metric supports, object-specific heights, and shared floor/threshold datum. Approximate envelopes or rectangle fallbacks must not close these gaps.

### Follow-up: ordered retained-paint fragments

Added source-linked subtraction of later paint from each existing positive candidate.
Cutters come from **all retained filled paths**, including small columns/windows and
same-colour repaints, not only the 14 candidate-sized shapes. Same-colour subtraction
describes the surviving part of one source operation; it does not say that the later
same-colour patch is occupied floor. No colour-based physical role is assigned.

Crossing boundaries use the existing source-backed planar graph. Face membership and
area accounting use rational intersection keys rather than rounded display coordinates.
Original segment indexes and intersection proofs remain attached internally. Completely
contained disjoint masks retain explicit holes. Mixed disconnected/intersecting topology,
ambiguous nearby intersections and incomplete area partitions hold the whole candidate;
there is no epsilon/snap repair or partial-layer promotion.

The extractor now retains the actual `stroke`/`fill`/`fill-stroke` role for curve and clipped
omissions. Legacy omissions without that optional provenance remain unknown. A documented
stroke-only omission does not block this **filled-path mathematical calculation**, but its
count remains nonzero and boundary-ink completeness stays false. Unknown/filled omissions
contacting a candidate hold it. Neither the kernel nor the public view confirms total visible
ink, a physical free floor, room/height ownership, centimetre scale or 2D/3D readiness.

Fresh original Rebrina page: candidate 1527 (study paint mask) gives one diagnostic piece
with three rational intersection proofs and 90 possible omitted stroke bounds. Candidate
11775 gives one diagnostic piece with two proofs; its physical role is unclassified.
Kitchen 1462 remains held for `ambiguous-nearby-intersections`, with all 21 later masks,
including small grey column 13501, accounted for. The other seven room masks are still
held. The unchanged global source count is 532 clipped paths. Do not report a successful
kitchen column cut, eight recovered floors or an accepted 3D plan from these results.

The UI has a separate purple fragment layer with even-odd hole rendering. The original
positive fill overlay is hidden while this layer is selected so it cannot visually fill
the calculated holes. Existing read-only inspection/load, private source pairing and save
behaviour are unchanged. DTO/core output limits agree: 50 regions, 100 pieces per region,
500 pieces globally, 10,000 points, plus an internal 1,000-intersection-proof limit.
Independent review caught a producer/client 110-piece mismatch; an atomic-refusal regression
now covers it.

Verification: 6,889 web tests / 302 files passed; seven-package typecheck, Biome 992 files,
production build and diff check passed. Actual original-PDF component QA with mocked private
HTTP showed the held kitchen and the diagnostic study fragment, preserved 532 omissions,
and had no warning/error console logs or document overflow at 1265/1265 and 375/375 pixels.
Proof: `output/playwright/real-plan-ordered-paint-20261011.jpg`. No new AI requests, source
file edits, migrations or account/project writes were made. This is not production account
persistence or full automatic 2D/3D proof.

**IMPORTANT:** decimal source-room numbering and split/subscript height captions need explicit source-linked support. A room number, a wall gap, a door swing and a free-floor threshold are different evidence.

**Recommendation:** ship the bounded correctness fixes after regression and UI checks; do not advertise complete automatic 2D/3D recognition for these sheets. Preserve original hashes and before/after evidence when extending the next stage.

Local evidence is under `tmp/real-plan-*20261011*`, `tmp/real-transfer-control-20261011/` and `output/quality-bench/plan-74-77-native-text-real-transfer-20261011/`. These ignored artifacts are not synthetic replacements for the PDFs.

## Live-account follow-up after hosting recovery

The host recovered after the owner reported topping up its blocked account. Read-only checks
found the PR106 web image healthy, SSH responsive, no uninterruptible disk processes and
normalizing I/O pressure. A new boot was observed; the agent did not reboot or stop the host.
This recovery does not establish the cause of the earlier disk stall or authorize further
support intervention. The other project on the same VPS must not be stopped.

The authenticated site has no new-project action under its current free-plan limit. The
existing disposable QA project `cd049367-2dab-4e92-99bb-809913d8ddfd` was reused, not the
owner's apartment or the synthetic delivery project. Its unrelated synthetic room and item
remain; its old manual geometry was invalidated by uploading a new source. The project title
and old total area are not the identity or area of the uploaded apartment.

Two uploads of the unchanged Rebrina original (10,779,428 bytes, below the 15 MiB file limit)
failed before persistence. Production logged `Unexpected end of form`. Next's proxy clones
request bodies with a separate default 10 MiB cap, and `/projects` passes through this proxy.
The old 16 MiB Server Action limit did not override that cap. The fix aligns both limits at
16 MiB, retaining the existing 15 MiB file limit and multipart allowance. A config regression
and a genuine HTTP/browser E2E with an 11 MiB synthetic PDF protect against truncation; no
copyrighted source or AI call is needed by that regression.

The unchanged 74.77 m2 original (5,842,197 bytes, same SHA-256 listed above) uploaded normally.
One fresh paid site reading of page 6 returned eight rooms and the eight documented areas.
Native post-reader checks withheld width/depth/ceiling claims and the model's geometry rather
than supplying estimates. The live private inspection loaded without a DTO error and showed
seven numbered floor candidates, seven opening-frame candidates, eight glazing-profile
candidates, 72 dimensional candidates, 16 height observations and 45 skipped curves.
These counts are observations, not a complete physical floor/opening/height inventory.

Four supported room records were transferred through the normal UI, with missing dimensions
left missing. A page reload retained the source page and saved room list. The old synthetic
control room was not overwritten. No accepted apartment footprint or 3D model was created.
The UI's next measurement link incorrectly chose the unrelated older room; it now prefers a
room matched to the current reading using the existing matching rules.

The live full-scale inspection also expanded the entire page from a 572 px viewport to
1,451 px. The full-size drawing now remains inside a bounded scroll region: shrinkable grid
tracks and ancestors do not rescale the original SVG or clip its annotations. Synthetic
layout controls verify only scrolling; they are not recognition proof.

Independent audit reproduced a separate native-source update dead end: importing an exterior
envelope without a floor, then adding the floor in the source review, left the metric draft
unchanged and reimport unavailable. A changed reviewed source could also leave old confirmed
geometry active. Matching source-derived geometry now receives a server-owned reimport hold,
retaining coordinates and raw surveys but withholding confirmation, volume, layouts, floor
levels and delivery certification. Identical geometry/proof refreshes and unrelated manual
drawings are not invalidated. Explicit acknowledged reimport uses fresh source evidence and
atomic revision checks; it only rebuilds a held source-derived draft, never confirms it.
Measurements are preserved only on unique unchanged owners. Unsafe reattachment refuses the
write and retains the old data; opening measurement certificates and changed vertical-datum
ownership still need a separate manual rebinding workflow.

Independent final review caught and fixed two additional boundary cases: JSONB reordering of
the legacy source identity could evade the stale-source hold, and a separately measured wall
thickness could be dropped during otherwise safe reimport. Regressions cover reordered source
properties and unchanged/moved wall owners with `measuredThicknessCm` as their only measurement.

**Live outcome:** upload, reading, private inspection and supported room persistence were
observed on the actual site. Automatic accepted 2D/3D remains blocked by physical-boundary,
metric-owner and vertical-reference proof gaps. Do not describe this as complete recognition.

## Source topology and height-caption recovery — 12 October

The unchanged original Rebrina page 3 now computes surviving paint for all eight
room-shaped source operations (1462, 1491, 1527, 1563, 1591, 1611, 1631, 1651):
nine pieces in total, not nine rooms. Previously only operation 1527 completed
among these eight. Kitchen 1462 includes all 21 later masks, including grey column
13501; its graph has 118 rational intersection proofs. No later mask was removed
to obtain this result. Rational cut identity survives face ordering, containment
and paint accounting instead of being rebuilt from rounded display points.
Distinct cuts aliasing to the same Number coordinate still cause atomic refusal.
Existing budgets and default physical/cavity graph guards remain unchanged.

Exactness is relative to retained extractor coordinates: the native line
extractor has already quantized coordinates to 0.001 page units. It is not proof
of lossless original PDF coordinates. All eight paint boundaries remain
incomplete; the global 532 clipped paths and possible omitted strokes remain
visible. These pieces do not certify physical free floor, room ownership or
2D/3D readiness.

Rebrina height-caption ink now retains ten source-verified contiguous glyph-show
groups, previously zero. Original operations, matrices and spacing are retained.
A narrowly verified Float32 text-matrix/raw TextContent lineage supplies a
conservative translation envelope, not a relocated exact glyph box. Producer
and consumer cap groups at 50 shows; the 51-show regression holds that group
without losing an unrelated valid caption. Rotated/sheared groups and mixed
text-object joins remain unsupported. The units note and four split/subscript
door/window captions on this sheet are not recovered. All ten height roles,
owners and their common vertical reference remain unconfirmed.

On unchanged 74.77 m2 page 6, verified height-caption ink increased from 14 to 16.
The two recovered captions contain an embedded whitespace glyph with a known
advance and explicitly empty native outline. Missing/nonempty outlines, unknown
advances and non-whitespace glyphs still refuse. The balcony-door caption is
not assigned to aperture versus leaf height without separate proof.

Independent opening audit found no defensible change to the rectangular stroke
detector: Rebrina still has zero frame candidates. Visible window bodies are
skew filled quadrilaterals; retained cap/body endpoints can differ by one
extractor quantization unit. Widening tolerances or declaring them physical
openings would invent evidence. The follow-up below instead uses exact source
paint overlap, without claiming a shared centerline or physical jamb. Floor
role, metric ownership and vertical-reference binding are still required before
automatic 2D/3D transfer.

Verification: 6,952 web tests / 303 files, seven-package typecheck, Biome 995 files,
production build and diff check passed. Independent final review found no
blocking issues after the producer/consumer cap fix. Original-PDF browser QA
showed all eight source-operation pieces in the purple layer, ten held height
observations, unchanged omissions and no warning/error console logs or document
overflow (1265 px document within 1280 px viewport). Screenshot:
`output/playwright/real-plan-source-topology-20261012.jpg`. The local component
uses mocked private HTTP, not authenticated account persistence. Its counters
recorded one inspection, one image request, zero mutations and zero paid requests.
No source-file edits or new paid AI requests were needed for this stage.

### Filled-quadrilateral profile follow-up

Independent inspection of the original decompressed PDF content showed that
the small cap/body endpoint differences exist in its original decimal lexemes,
not only in PDF.js Float32 buffers or our extractor rounding. Nevertheless,
all four body/cap pairs strictly overlap as polygons in both original drawing
coordinates and retained extractor coordinates. This supplies source paint
contact, not a shared centerline, full jamb or physical opening.

A separate bounded whole-inventory detector now finds two source profiles on
Rebrina page 3: body 2035 with caps 2031/2027 and body 2059 with caps 2055/2051.
These are two drawn profile components, not a claim of two windows. Each has
a convex filled four-vertex body and caps covering opposed short-edge midpoints
with exact positive polygon overlap. Rotation/shear do not require invented
orthogonality; fill colour supplies no window/door semantics. Original vertices
and operation refs are preserved. Competing caps, shared components and body/cap
role conflicts hold the corresponding profiles. Whole-page search and result
limits refuse atomically instead of exposing a partial accepted inventory.

Independent review caught an approximate JS midpoint witness and a producer/
client mismatch for a component used as both body and cap. Both were fixed:
midpoint predicates now use source-decimal integer numerators with denominator
two, and competing component roles are held before transport. Negative tests
include true boundary contact, tiny gaps, competing bodies/caps, malformed
provenance, source mismatch and budget exhaustion. The actual-PDF test searches
the entire original SHA-pinned page, not a production source-ref allowlist.

The private inspection has a distinct `filledPanelSymbols` contract and an
opt-in red dashed source overlay. Neither existing opening frames nor glazing
profiles are replaced. All physical jamb, passage, floor-closure, final-paint
visibility and complete-opening-inventory flags remain false. The two profiles
retain 20/22 later-operation warnings; 532 global clipped paths remain visible.
Original-PDF component browser QA showed both profiles over their actual source
positions, ten held height observations and no warning/error console logs.
Proof: `output/playwright/real-plan-filled-profiles-20261012.jpg`.

Final local verification for this follow-up: 6,993 web tests / 304 files,
seven-package typecheck, Biome 997 files, production build and diff check passed.
Independent review rechecked both fixes and the unchanged actual original.
The standalone browser recorded one inspection, one image request and zero
mutations/paid requests. This is not yet a live-account deployment receipt.

### Earlier offline regression verification

- Full web suite: 6,821 tests / 300 files passed, including local-only original PDF re-extractions when that ignored source exists. Public CI does not require copyrighted PDFs; deterministic unit controls remain present there.
- Typecheck: seven packages passed. Biome: 988 files passed, changed code formatted. Production build and diff check passed.
- Independent review caught a missed metre-unit exception; it was fixed with negative inventory tests. The reviewed source-transfer path, native floor guards and unsupported/foreign/malformed-source refusals remain intact.
