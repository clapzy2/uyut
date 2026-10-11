# Production acceptance: delivery measurements, PDF and 3D

## Scope and release

- Feature PR: [101](https://github.com/clapzy2/uyut/pull/101), merged as `698291da9a64f1452fe1270638d5f1db0d6d0e02`.
- Legacy empty-collection compatibility fix: [102](https://github.com/clapzy2/uyut/pull/102), merged as `735a18144408fb328c3934a8806be414c3dbd255`.
- PR and main checks passed; main worker deployment is `20261011.2`.
- Coolify deployment `ncdghrinhxqtgkod4j5nns33` finished; the web container with image `735a18144408fb328c3934a8806be414c3dbd255` was healthy and the older web container was no longer running.
- The initial hotfix deployment stalled before helper startup. Only that deployment was cancelled and retried. The existing healthy application stayed running. No platform-wide restart, pruning, migration, or database restore was performed.

## Controlled production fixture

[QA project](https://domitsa.ru/projects/88476065-7e20-4e8f-ab39-6a887995cd85) belongs to the existing synthetic acceptance account.

An isolated project and two rooms were provisioned with guarded operator SQL. No delivery measurements or checked report were preseeded. All subsequent saves, loads, calculations and PDF launch used the authenticated application UI.

The geometry, PDF wall-face evidence and measurements are synthetic, explicitly labelled as such. This is **not** an end-to-end image/PDF recognition test, validation of the user's apartment, a physical delivery simulation, or evidence of safe work by movers. General geometry validation warnings remain visible and were not bypassed by saving a new confirmed geometry.

Fixture: rigid package `40 x 60 x 170 cm`, zero clearance; lower floor `0 cm`, upper floor `198 cm`, ten `28 cm` treads with `18 cm` rises; measured exterior access and a fixed-open door leaf. The saved legacy geometry intentionally has absent `obstacles` and `kitchenItems`, while the editor represents them as empty arrays.

## Observed acceptance results

1. Portable JSON import accepted the equivalent legacy geometry. Applying it explicitly replaced measurement fields without granting acknowledgement or producing a checked route.
2. UI draft save succeeded. Reloading the page cleared local fields; loading and explicitly applying the account draft restored the package and all stair/exterior/door-leaf fields. Acknowledgement remained unset.
3. Fresh acknowledged calculation produced a continuous exterior-to-target route: `28` positions, `23` stair stages, `30` checked nodes/stages. The interface displayed the exterior and door-leaf scope and physical limitations.
4. Server recalculation and save succeeded. A narrowly scoped database read confirmed both delivery measurements and checked report existed on this project.
5. The 3D checked-volume view rendered, advancing stages changed the absolute Z bounds, and the view rotation control worked. This is a display of conservative checked volumes, not furniture animation or a guarantee of delivery.
6. Changing package width from `40` to `42 cm` cleared acknowledgement, checked-route download, server checked save, route result and 3D. Restoring the original profile required a fresh acknowledgement/calculation. The valid original report was saved again.
7. Summary composition showed the stored server route, `28` positions and `23` stages after leaving the editor.
8. The first PDF start failed before creating an export because session-cache lookup received an empty Upstash response. Status recovery and an own-project database read confirmed zero exports, avoiding a duplicate launch. One subsequent UI launch succeeded.
9. PDF progress advanced to completion without page reload. Export `faf36f32-bd48-424a-b0e2-a0123ceb143f` produced a free watermarked `15`-page document in about `21` seconds, downloaded through the application's link.
10. All 15 pages were rendered with Poppler and visually reviewed. Floors/general zero, route overview, all 28 XYZ positions, 12 stair regions and all 23 movement bounds were present. No clipped rows or overlapping text were observed. Room warnings and physical-delivery limitations remained present.
11. In the narrow browser view, document width equalled viewport width (`572 px`), with no horizontal overflow. A requested 390-pixel override did not take effect in the connected browser; therefore this is not a verified 390-pixel device test. The override was reset.

Local evidence: `output/playwright/delivery-production-3d-20261011.jpg` and `output/pdf/delivery-production-qa-20261011.pdf` (ignored artifacts, not repository assets).

## Remaining limitations

- A focused follow-up retries an auth-storage GET once for the actual SDK empty-body JSON parse error. A second failure still propagates; set, delete, get-and-delete, counters and limits are unchanged. This does not implement sustained-outage DB fallback. No auth/rate-limit bypass was used in this acceptance.
- PDF movement tables currently preserve raw conservative floating-point bounds, including long decimal tails. They fit, but user-facing numeric presentation could be improved without weakening calculation bounds.
- This acceptance does not cover live simultaneous-tab CAS conflicts, payment, AI recognition, real source wall extraction, or physical transportation. Their automated checks and other QA records are separate evidence.
- No existing customer project, account role, subscription, password, or session was modified. Only the isolated QA project's measurements, report and free export were written through the UI.
