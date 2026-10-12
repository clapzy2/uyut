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

### Follow-up: retain source vertex evidence through the contour editor

The existing server accepts bounded native segment crossings in reviewed room,
exterior and separate-floor vertices. The client previously dropped `vertexProofs`
when hydrating rooms/exteriors, grouping source identities and serializing every
boundary type. A saved non-node crossing therefore became unsaveable on reopening.
Five focused controls reproduced this before the fix.

The editor now clones and retains these exact source snapshots. Exterior/floor
serialization uses the same fresh source-vertex check as rooms, with current
segments; absent segments, changed snapshots, rounded corners, duplicate evidence
and line extensions remain held. Only same-index, exactly unchanged vertices keep
their evidence during edits. Removed/moved vertices lose it, and coordinate undo
does not manufacture a new proof. Role/closure/identity grouping does not move
vertices and therefore preserves their evidence.

A synthetic existing transfer control now includes room/floor/exterior editor
round-trip before metric import and compares the complete result to the original
draft. It does not confirm measurements or enable `planVolume`. This is not a new
real-source recognition or live-account write: painted floor roles, rational paint
intersections, physical boundaries, common scale and vertical datum are untouched.
The real-plan physical-to-editor bridge and complete 2D/3D/PDF remain unfinished.

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

### Explicit floor-source ownership, end coverage and documentary reference notes

The next bounded stage adds an explicit source-space floor selection. Every
selected polygon/hole snapshot is recomputed from fresh paint operations and
compared without moving source points. Exact intersection keys, masks and
boundary references are retained. A reviewed caption-origin association keeps
the literal source room key, including `3.1`, independently of the old integer
room schema. It does not assert whole-glyph containment or accepted physical
ownership. Boundary roles are source-review declarations; unknown roles remain
unknown. Hole boundaries do not acquire invented wall roles.

The original QA selection contains eight named pieces, with 144 unresolved
outer edges. Wardrobe 1631's unlabelled second piece is not assigned another
floor owner. The kitchen/entry paint transition near the beam/column is not a
continuous wall, and the kitchen/bedroom transition is not snapped into a
threshold. All source boundaries remain incomplete. This is not an automatic
physical-floor classifier or a complete apartment model.

An owner-only action stores validated declarations as a separate JSONB-backed
reading field through the existing repository CAS. It validates UTF-8 size,
current PDF/page/state, original and raster hashes and fresh source geometry.
Every nested input object is strict; client-supplied proof/physical claims are
rejected during saving and subsequent recheck. Existing rooms, geometry,
page review and delivery surveys remain unchanged. Same-page/state rereading
and room confirmation retain the owner's field; AI-supplied selections are
never adopted. Changing pages does not carry the selection forward. A separate
advanced JSON editor requires explicit acknowledgement, is not an ordinary
finished graphical floor editor, and never confirms measurements or transfers
the draft to 2D/3D.

The source profile-end correspondence now searches independent exact-collinear
edges across the whole inventory. Actual 2035 has one complete stroke end 2131
and competing fill/stroke coverage 2023/2115 at its other end. Actual 2059 has
competing coverage 2047/2223 and no exact independent opposite end. Nearby 2207
is not moved to fit. These profiles belong to the larger source cut 1959;
mullions/brackets must not be declared structural wall jambs. All physical
jamb, wall, passage, visibility and floor-closure acceptance remains false.

Two documentary notes now retain source-linked reset/TJ fragments: units 237
uses operations 14076/14079/14082; finished-floor height reference 230 uses
14006/14009/14012. Glyph widths, spacing, literal TJ values, original packed
matrices and explicitly generated PDF.js spaces are validated. Bounds include
Float32 operand uncertainty, not invented exact baseline coordinates. These
notes specify units/reference kind only. The two H=360 rises, beam heights and
unclassified H captions do not establish surface ownership, coplanar floors
or one shared world zero.

Independent review caught two recheck-contract differences: unknown proof keys
in saved JSON and end indices that could refer to long body edges. Strict
core keys now refuse the former; the wire validator checks actual short-edge
parity and independent source references, refusing own body/caps. Regressions
cover both failures. Final local verification: 7,121 web tests / 309 files,
seven-package typecheck, Biome 1009 files, production build and diff check passed.
Original-PDF component QA loaded all eight saved source selections, literal
`3.1`, the verified local reference and held jambs, with no warning/error logs
or overflow (1265 px document within 1280 px viewport). Its mocked private HTTP
recorded one inspection, one image and zero mutation/paid requests. Screenshot:
`output/playwright/real-plan-selected-floors-20261012.jpg`. This offline fixture
is not yet a live-account persistence receipt.

### Cardinal discovery cost and bounded clipped dimension ink — 12 October

The discovery reservation previously counted every two-point stroke on both
cardinal axes, including rotated walls, and reserved nonexistent arrow spans.
The per-axis cost now uses the strict verifier's own cardinal rail/arrow
predicates. Off-axis strokes still participate in competing branch checks;
the 4,000,000 work cap and 2,000 arrow-span guard are unchanged. The unchanged
Rebrina original has 2,124 paths, 132 horizontal and 149 vertical eligible
rails and no arrow candidates. It now yields one original 580 mm chain:
native-text-120, rail 8058 and ticks 8064/8068. Twenty-two cardinal captions
remain unconnected and 68 orientations remain unsupported by this legacy
discovery stage. This is not a scale calibration or source-floor dimension.

Source-caption inspection can now explicitly request bounded clipped-ink
scope. Counts, bounds, operations, paints and truncation are checked before
inspection; separate omitted subpaths may share a paint operation, and whole
omitted-path bounds may legitimately extend outside the page. All omitted
paints remain competitors. Original-frame checks cover the full caption/rail
envelope and the rail-to-face witness envelope. Rotated matching maps back
before checking omissions; projected unrotated omission bounds do not prove
source visibility. The primary caption caller also rechecks centred witnesses
for dependent outboard captions. Physical and legacy source guards keep the
strict default; no omitted source path is erased or promoted to a wall.

Fresh original extraction still holds full caption bindings, targets and
scale with source-caption-ink-incomplete after the global clip refusal is
removed. Investigation identifies numeric show identity/Float32 origins,
character spacing, nonbreaking spaces and orphan numeric fragments inside
height/date/area captions as the next proof-recovery work. No plain H caption
was assigned to a ceiling, no neighbouring bathroom height was copied, and
the finished-floor note still does not establish a common zero. No current
floor selection, source, saved measurement or accepted geometry was modified.

Verification: 7,147 local web tests across 310 files passed with four workers,
including original-PDF replays; seven-package typecheck, production build,
changed-file Biome and independent review passed. The first unrestricted
parallel run hit the existing 5-second original-PDF test timeout under load;
its isolated run and complete bounded-worker rerun both passed. No test timeout
or source/proof gate was relaxed. This verification is local, not a live-account
or deployment receipt.

### Numeric source recovery and saved room-height associations — 12 October

The unchanged original now produces 91/91 numeric TextContent ink items.
There are 69 actual dimension captions; the other 22 are seven schedule keys,
seven integer room keys and eight m² superscripts. Dates, H values, room `3.1`
and other numeric show fragments are excluded only through a uniquely verified
complete source owner. Single-show origin recovery reuses inverse CTM/cursor
and original Float32 cells rather than widening coordinate tolerance. Explicit
character spacing and full glyph advances must reproduce TextContent width.
The mapped NBSP has its actual empty outline checked; its original spelling,
advance and spacing are retained. Other Unicode substitutions, nonempty NBSP,
changed widths/cursors/matrices and competing owners remain refused. The old
single-H shape is retained: adding a numeric single-show proof must not make
height consumers require a nonexistent multi-show group.

Rotated matching privately reuses the fresh source span inventory instead of
reserving 200,000 comparisons for every angle and replaying the same search.
The overall 4,000,000 cap is unchanged. A separate 64-frame cap accommodates
the original's 33 distinct baseline angles without clustering or snapping.
A real 651-overlapping-span control tests atomic budget refusal, not just a
mock. Five source captions bind to original rails: 68=1506, 70=684, 99=817,
100=430 and 136=530 mm. All five are aligned, not cardinal. The 64 actual held
dimensions comprise 27 unresolved rails, 29 omitted-ink cases, seven branches
and one competing caption. Existing target matching still does not accept
these aligned dimensions as physical wall/jamb or saved-floor measurements.

New owner-only actions load source-height choices and save explicit label/floor
IDs with the source snapshot, floor-review revision and full-reading CAS. Values
are always freshly derived. AI cannot write this field; unchanged page/state
reading retains it, changed floor selections invalidate it. Whole caption
containment uses exact paint keys including intersections, holes, touching
edges and non-convex boundaries; origin containment alone is insufficient.
Units and local-floor-reference ink must be verified. This is a manual source
association, not a classified ceiling or a common world-zero acceptance.

Explicit original QA selections: entry 1 / label152 / 3773 mm; kitchen-living
2 / 153 / 3790; bedroom2 5 / 154 / 3780; study6 / 159 / 3790; bedroom1 3 / 165 /
3790. No bath or wardrobe height is copied. Eight eligible spatial choices
also include unclassified beam/rise H captions; the UI does not select them
automatically and explicitly requires checking object meaning on the sheet.
The ordinary select UI preserves missing rooms, requires acknowledgement,
resets acknowledgement after editing, retains choices after an error and
reloads saved IDs through fresh verification. The source packet rechecks saved
bindings and its wire contract rejects changed values/owners/reference IDs or
physical/global/3D promotion. All geometry readiness flags remain false.

Local UI control used the real source-derived options but a clearly labelled
mock account action boundary. It observed two loads, one deliberately refused
save and a successful retry with five selected IDs; no actual account mutation
or paid request. It also checked the unchecked initial state, edit-induced
acknowledgement reset and three missing-height floors. Console warnings/errors
were empty and document width1265 stayed inside viewport1280. Screenshot:
`output/playwright/floor-height-ui-20261012.jpg`. This is not a live-account
persistence receipt. Independent reviews found and fixed the single-H shape
regression, checked numeric operation ownership and the source-height actions.
Final local gate: 7,219 web tests / 313 files passed with four workers,
seven-package typecheck, production build, Biome1017files and diff check passed.
No PDF, source coordinate, accepted model or unrelated stored measurement changed.

### Exact aligned source targets — 12 October

Aligned captions no longer stop at the categorical unsupported-orientation
gate. The existing target verifier checks unchanged source whole-face vectors,
both perpendicular endpoint relations and bounded extension witnesses. Decimal
BigInt signs use page width²/height²; image-normalized perpendicularity on a
non-square PDF is not physical-page perpendicularity. Exact repaint aliases
are retained, differently bounded witnesses remain alternatives, omitted ink
holds the result and the 2,000,000 work budget remains unchanged. Literal
detached gaps are measured in physical PDF points. Neither points nor angles
are snapped, fitted or inverse-projected. The cardinal jamb interval contract
is not reused for aligned faces.

Exact rational rotated synthetic controls pass on square and non-square sheets,
including a 2.5-point detached gap, reversed extension and face endpoint order,
alternative boundary order, branching, tiny nonzero contacts, omitted ink and
a closed detached path. Those controls are not an original-source success.
The unchanged Rebrina original still returns five unresolved whole-target rows
and no target/jamb interval. A local-only fresh original regression asserts
that refusal, source immutability and false 2D/3D transfer flags.

Independent inspection of original PDF decimal operands, not just render
Float32 values, finds all ten apparent rail-tip/extension centreline contacts
nonzero. The visible pen ink overlaps, but is not exact centreline incidence.
Drafting extension endpoints stay about 1.68 PDF points away from nearby
source faces. 1506 concerns a window-block span; 817/430 are door-related
subspans; 530 concerns column/beam geometry, not a whole entry-floor face.
684 has an equal translated vector to source fill1858 edge2, but vector equality
alone proves neither physical ownership nor the complete extension contact.
These cases must not be labelled Float32 noise or closed by an arbitrary tolerance.

Wire tests retain continuous/detached aligned source rows without geometry
authority and reject a fabricated cardinal jamb interval for an aligned label.
The UI names source boundaries/frames as unconfirmed and shows direction;
it explains the difference between visible stroke overlap and exact contact.
No accepted geometry, stored floor, height binding or room measurement changes.
Local gate: 7,236 web tests / 313 files passed with four workers, seven-package
typecheck, production build, Biome1017files and diff check passed. Independent
review found no blocking issue and the reversed-endpoint regressions passed.

### PDF.js pen-interior observations — 12 October

The extractor now retains unrounded PDF.js DrawOPS operands, the complete
affine pen matrix and width/cap/join/miter/dash state, including q/Q and GState.
These operands are not the original PDF decimal tokens. Existing rounded
diagnostic polygons and every accepted geometry interface stay unchanged.
Only open two-point solid strokes have an interior model. Device hairlines,
dash, unsupported state/topology, singular transforms and boundary-only
contacts are held. Rectangular clipping uses its separate unrounded bounds
and a conservative whole-pen envelope, not centreline-only containment.
Independent review caught a rounded-mask false positive for an extremely
thin pen; separate precise mask bounds and a regression remove it.

Fresh original Rebrina page3 extraction returns five caption observations with
ten tips inside neighbouring stroke models. All source alternatives are kept;
no nearest-witness winner is chosen. No exact whole-face target is recovered.
Final occlusion by other paint, text and images is explicitly `not-checked`,
not claimed visible. The UI keeps this distinction next to the dimension
target report; the wire rejects visibility/physical/2D/3D authority, stale
caption references, malformed tips, self/duplicate references and partial
positive output on refusal. Saved source-floor/height selections are not
mutated. Physical owners, independent scale and reference levels remain
required before any transfer.

Local gate: 7,310 web tests / 314 files passed with four workers, seven-package
typecheck, production build, Biome1019files and diff check passed. Original
PDF re-extraction is local-only; synthetic tests run without private/source files.

### Ordered paint exclusion and selected dimension spans — 12 October

Every native vector paint is inventoried before path omission or clipping,
using unrounded control-point envelopes, affine pen width/cap/miter expansion
and the installed PDF.js minimum-device-pixel stroke rescaling at the actual
render viewport. Unsupported paint is an indexed unbounded blocker, not absent
ink. Unit image quads are bounded under the current transform; unsupported image
repeats, shading and legacy paint stay unknown. Actual glyph outlines are
collected before PDF.js deletes them during canvas compilation. Unclipped text
control hulls remain supersets under masks; independent non-clipping state
refusals preserve opacity/pattern/font/mode uncertainty. FontBBox and advances
are never substituted for glyph ink.

Contact pairs scan later paint after the earlier member. Only the two proven
single-subpath source strokes are exempt; a third stroke of the same colour,
a compound source operation or an unknown envelope holds visibility. The report
retains all original alternatives, possible blockers and unoccluded point refs.
This is not visibility of a whole rail or an accepted physical boundary.

Fresh Rebrina page3: 2,966 ordered paints; the only null envelopes are nine
proven-empty text shows. All ten ink contacts remain held due potential third
paint, not a missing text inventory. One exact whole-vector proposal links
684 mm to selected kitchen-living floor edge40/source1858:0:2; four other
captions remain without a whole selected-edge proposal. Rational endpoints,
source refs, declared role and incomplete boundary evidence remain separate.
All eight selected floors have incomplete boundary ink. Physical walls/jambs,
extension contacts, independent metric scale and datum/levels are not proved.
Saved floors, heights and accepted geometry are unchanged.

Local gate: 7,434 web tests / 315 files, seven-package typecheck, production
build, Biome1021files and diff check passed. Independent review found a mixed
source/visibility reference budget in the wire; separate 20k counters and a
40k combined-reference regression fixed it. Original replay remains optional
and local-only; deterministic controls run in CI without the original PDF.

### Straight-stroke spatial exclusion and whole selected segments — 12 October

Single open two-point stroke paints retain a conservative unclipped capsule in
the effective PDF.js raster-pen frame. Physical pen evidence is unchanged.
Dashed gaps do not shrink the capsule; round caps include endpoints, square
caps use an enclosing sqrt2 radius. AABB remains the fallback for unknown,
compound, curved and unsupported paint. Inverse-frame separating axes prove
disjointness only; arithmetic/coordinate uncertainty is outward and ambiguous
boundaries remain possible contact. The same predicate checks points and entire
segments, including a middle crossing with clear endpoints.

On the unchanged original, four false AABB hits from source7251 and one from
13680 are excluded. All ten tips still have genuine later gray drafting ticks,
black round-cap successors or crossing source strokes. There is no same-colour,
symbolic-tick, nearest-witness or repaint-owner shortcut.

The selected 684-mm proposal now reports whole literal-edge exclusion for
source1858:0:2. Only complete source endpoints equal to validated rational
selection keys qualify; equal rounded display values do not qualify. The
0.0005 normalized-coordinate rounding bound belongs only to exclusion, not
contacts. The real whole segment remains held by potential late paint. This
diagnostic concerns the mathematical selected segment, not its whole painted
strip, physical wall/free-floor side/jamb identity, measurements or 2D/3D.
The wire checks scope, source-ref subset, late blocker ordering and immutable
physical readiness. Saved floor and height associations are not modified.

Local gate: 7,524 web tests / 316 files, seven-package typecheck, production
build, Biome1023files and diff check passed. Independent original/source and
product-code review found no blocking issue. Original regressions remain
optional/local; synthetic whole-span and malformed/refusal controls run in CI.

### Spatial omission checks in the existing wall-to-metric path — 12 October

Cardinal wall pairs now exclude genuinely disjoint omitted paint in both axes
of their source wall strip. Recorded counts and finite ordered envelopes are
validated; multiple omitted subpaths from one operation remain valid. Pure fill
control hulls bound paint, but stroke/fill-stroke/unknown omissions require a
complete matching vector ink envelope. Unknown pens, null bounds, same-source
witness operations, corner slivers and genuine contact stay held. Rounded
strip coordinates retain an outward quantization/arithmetic exclusion margin;
this is not geometric fitting. Complete paint inventory is indexed once.

Native face cycles use whole-span rectangle/capsule exclusion rather than
overlapping diagonal AABBs. Positive-paint partitioning itself is unchanged;
omission completeness is checked after partitioning against every surviving
outer and hole boundary. Interior annotations can be excluded only from a full
ink envelope, never from their centerline hull or colour. Missing pen coverage
now holds instead of authorizing a boundary by a distant raw path box.

Fresh original page3: selected source1527 boundary candidates reduce from90
to71, excluding19 false spatial blockers. All eight selected source floors
remain incomplete, ten dimension-tip contacts and the whole684segment remain
held. The full paint inventory remains2,966, with532 recorded clipped paths.
Saved source floors/heights, rational keys and physical readiness are unchanged.

One synthetic integration regression uses existing printed3000/4000chains and
explicitly reviewed adjacent rooms. A remote full-pen envelope preserves the
source wall pair in the metric draft; drafts cannot feed layout or volume.
The separate confirmation adapter retains the300×400cm local floor and both
original wall faces in3D, without invented height/solid authority. Reaching or
unknown ink drops the pair and blocks volume even with a confirmed-status
control. This proves the controlled path, not the real apartment's readiness.

Local gate:7,551web tests/316files passed with4workers, seven-package typecheck,
production build, Biome1,023files and diffcheck passed. Full unconstrained
parallelism initially hit5s test timeouts under Windows contention; the bounded
worker replay passed without increasing timeouts or skipping local PDF checks.
Independent review found a precise-envelope/rounded-wall margin and repeated
inventory scans; both corrected with near-boundary and access-count controls.

### Distinct printed subroom identities — 12 October

Shared dependency-free source-number validation retains numeric 3.1 separately
from 3 through source reading, reviewed contour persistence, editor choices,
metric draft, measurement ownership and vertical-reference snapshots. Printed
identifiers are not measurements or array/operation indices. Existing metric
import count/range limits, authentication/CAS and physical readiness are unchanged.

Whole-room table rows retain their ordered 1..N counter; optional distinct
subrooms immediately follow their printed parent without implying absent children.
Native circles, boxed captions and complete-grid tables preserve canonical
decimal markers and literal source slots. Ambiguous comma/trailing-zero or
overprecise text is held, not normalized or silently dropped. Legacy whole-room
padding remains only in its previously supported profiles. All three AI table
profiles were checked; the explicit-heading separated-column profile still
allows its legacy partial integer inventory, not a claim of completeness.

Synthetic regressions retain 3 and 3.1 in editor/saved source contours and route
selected 3.1 into a metric draft with anchor 3.1. Unknown heights stay unknown.
Reviewed vertical floor owners and shared-zone snapshots preserve the distinct
identifier; replacing it with parent 3 or unsupported precision refuses approval.
No test status or caption role is promoted to physical source proof.

Fresh original page 3 retains 8 checked selected floors with literal keys
2, 5, 6, 3, 7, 4, 3.1, 1 and 5 checked height associations. Native full schedule remains
held (`unsupported-or-ambiguous-room-table`), so this is not complete recognition
of the original apartment or a confirmed 2D/3D import. No source/account geometry
was rewritten. Local gate: 7,654 tests / 317 files with 4 workers, seven-package
typecheck, production build, Biome 1,025 files and diffcheck passed. Independent
review caught silently skipped separated/combined child rows and an exponential
numeric-text alias; fixed and regression-covered before release.

### Explicit recovery of identifiers lost by older readings — 12 October

Live PR119 QA found that the saved original Wardrobe reading had no numeric
identifier. Source floor3.1 was still checked, but editor choices remained1..7.
The identity guard therefore required a legacy-data recovery path, not a claim
that the old editor could already select3.1.

The new owner-only actions prepare the current PDF again, verify its hash/page
and raster provenance, and derive a fresh painted-floor review. A missing room
number is proposed only for a unique exact-trim reading name and unique reviewed
source owner. Known numbers, collisions and ambiguous names are never replaced.
Save accepts only selected floor IDs/room indices plus explicit acknowledgement;
the server recomputes mappings and uses full-reading atomic CAS. Only the missing
sourceNumber changes. Every measurement, geometry and saved floor/height review
is retained. No AI request or metric/physical confirmation is involved.

UI uses the existing form conventions and requires load, unchecked selection,
and explicit source-number acknowledgement. Dirty room rows and an open source
editor block recovery; pending recovery locks the parent form so a returned
reading cannot overwrite newly typed edits. Unknown save outcomes require a
page refresh rather than blindly retrying a stale revision.

Local gate: 7,692 tests / 320 files with 4 workers, seven-package typecheck,
production build, Biome 1,031 files and diffcheck passed. Independent review
found no blocker; live async load/save locking and post-reload editor selection
are the remaining deployment checks.

### Earlier offline regression verification

- Full web suite: 6,821 tests / 300 files passed, including local-only original PDF re-extractions when that ignored source exists. Public CI does not require copyrighted PDFs; deterministic unit controls remain present there.
- Typecheck: seven packages passed. Biome: 988 files passed, changed code formatted. Production build and diff check passed.
- Independent review caught a missed metre-unit exception; it was fixed with negative inventory tests. The reviewed source-transfer path, native floor guards and unsupported/foreign/malformed-source refusals remain intact.
