# TWINFORGE private live SAM Worker

This self-contained Worker serves the current public frontend and implements
`GET /api/sam/status` and `POST /api/sam/segment`. SAM 3.1 receives the exact JPEG
and either an object concept or the user's spatial selection. Source identity/time remain in the local receipt; no
simulator seed, positions, velocities, masses or forces are accepted.

The official `@meta-sam/parser` decodes each provider mask. Foreground pixels
produce the centroid and area; their JPEG colors produce the median color.
The endpoint never creates a local segmentation fallback. It returns the same
`twinforge.sam.frame.v1` observation contract as the Python runtime.

## Tap and box selection

The request optionally includes `selection: {type:"point", x, y}` or
`selection: {type:"box", x, y, width, height}`. Coordinates must be integers in
the **submitted JPEG**, not CSS/display pixels. The backend validates every
coordinate before reserving any cost and constructs the native SAM 3.1 object
prompt with id `1`. Box endpoints are converted to inclusive coordinates.
When selection is present, its location prompt replaces the concept string;
it is never appended to a noun phrase. This is the native interaction documented
by [Meta's segmentation guide](https://dev.meta.ai/docs/sam/segmenting), not a
crop, guessed category, synthetic mask, or simulator-state shortcut.

The response echoes the validated `selection` and its `prompt_kind`. The exact
provider request, including that prompt and the original full-frame JPEG, is
covered by the existing request hash. A refresh must use a newly observed
object location, rather than repeating a historical click on a different frame.
`source_kind` distinguishes `synthetic`, `camera`, and imported `video` frames.

`timings_ms` separates input decoding, reservation/preparation, provider
round-trip, mask decoding, and elapsed server time until the result is built.
Final durable settlement and the browser's upload/download time are outside
`server_until_result`; the browser should measure its own complete round-trip.
Spatial prompting fixes object selection, but is not by itself a guarantee of a
faster hosted-model response. Local visual tracking runs between sparse SAM
requests; it must not be labelled as per-frame SAM inference.

## Prepare the source

From this directory, with the final application changes present:

```sh
npm ci --ignore-scripts --no-audit --no-fund
node scripts/stage-public.mjs /absolute/path/to/twinforge
npm test
npm run build
npm run validate
```

`stage-public.mjs` copies only named public entries and allowlisted extensions
under `web`, `assets/mobile` and `assets/vendor/three`. It never scans private
uploads, `.twinforge`, environment files or `output`. The complete `public/`
snapshot and `public-assets.json` belong in the Site's source checkout so its
build does not depend on the original repository. Re-run staging after changing
the app. A build then embeds every asset into `dist/server/index.js`, as required
by the Sites Worker ESM starter. There is no external static-assets binding.

The manifest preserves project `appgprj_6aeb201bbbb88191b56d8dd45accb560` and uses
`"d1": "DB"`. This exact logical binding form is documented in the installed
Sites Vinext starter's `db/index.ts`. `drizzle/` contains generated SQL, journal
and snapshot; Sites packaging includes these and applies hosted migrations.
Keep migration history immutable after publication.

Use the normal Sites source/build/package workflow. Copy this prepared source
into the existing private Site checkout, preserving its identity and existing
access configuration. Do not create a new Site or change its audience. The
Sites platform's existing owner-only authentication gate protects the routes;
this Worker does not introduce a public API proxy or an alternate sign-in gate.

## Runtime environment and one budget

Set these through the native Sites runtime environment tool, never source:

* `META_MODEL_API_KEY`: the existing authorized Meta key.
* `INITIAL_VISION_SPENT_UNITS`: prior spend or allowance reserved for the local
  server, in integer units of 0.0001 USD. This deployment uses `1000` ($0.10
  reserved locally), leaving at most $0.40 for hosted SAM under the default cap. This is an allocation,
  not a claim that $0.10 was already spent.
* `TOTAL_VISION_BUDGET_UNITS`: optional combined local/prior-plus-hosted ceiling,
  also in 0.0001 USD units. Omitted, it remains `5000` ($0.50). Explicit values
  can be canonical positive integers from `1` to `20000` (the finite mode's
  $2.00 hard maximum). The exact string `unlimited` explicitly disables
  Twinforge's total spending and 60-image per-run caps; Meta account credit and
  provider limits still apply. Other malformed or larger numeric values disable
  paid calls. This source change does not set the deployed allowance; runtime
  configuration explicitly activates unlimited mode.

Missing configuration or missing D1 storage disables paid calls. The initial
spend is persisted in D1; subsequent configuration can increase it but cannot
lower it. The default global ceiling is 5000 units ($0.50), every image reserves
25 units ($0.0025), and finite mode permits at most 60 paid requests per run. A new random
scene, a Worker restart or a different phone cannot reset the shared ceiling.
Changing the configured ceiling also cannot reset any stored reservation or
baseline. If it is lowered below existing commitments, further paid calls are
blocked; committed charges are never refunded by a configuration change.

The paired local server uses `TWINFORGE_LIVE_SAM_BUDGET_USD=0.10`, including
all existing local vision charges. The hosted baseline reserves that entire
local share and, with the default cap, leaves $0.40, so the two live services
together cannot exceed $0.50. Changing random trials or redeploying cannot reset either share. Do not
raise the local share without reserving the increase in D1 first. The Worker
cannot observe subsequent changes to local environment configuration.

In `unlimited` mode, `budget.unlimited` is `true`, while
`budget.limit_per_scene` and `budget.remaining_requests` are JSON `null`.
The status response also sets `remaining_requests`, `remaining_usd`, and
`max_requests_per_run` to `null`. These nulls mean no Twinforge cap, **not** a
zero allowance or an unlimited Meta balance. Status can accept another frame
when credentials and persistent storage are configured and no frame is in
flight. Its ready message is: “No Twinforge spending cap. Meta account credit
still applies.” Recorded reservations, prior/local allocation, idempotency,
strictly increasing timestamps, and one in-flight request remain enforced.
Switching between finite and unlimited mode never resets the ledger. No Meta
account balance is queried or inferred by this service.

All quota predicates are in one conditional D1/SQLite `INSERT`. The database
also enforces unique `(run_id, frame_id)` pairs. A reservation is retained even
if Meta fails or the request is interrupted. One provider request can be in flight;
an abandoned slot becomes available after 30 seconds but its dollars remain
charged. The Worker registers the paid task with `context.waitUntil` before
awaiting it, so a tab reset or disconnect does not cancel durable settlement.
The provider request has a 15-second deadline, inside the
[documented post-disconnect Worker lifetime](https://developers.cloudflare.com/workers/runtime-apis/context/).
Only the rejected busy path
returns `code: sam_busy` with `retry_after_s` (1–3 seconds); budget/run limits
never suggest an automatic retry. Every rejection before the provider explicitly
returns `provider_call_made: false`.

The free status endpoint reports `service_state` (`ready`, `busy`, or
`unavailable`), `accepting_frame`, an explicit `reason_code`, and a user-facing
`message`. Busy is temporary and does not mark a configured service unavailable;
`retry_after_s` and `busy_until_ms` describe that wait. Billed provider failures
carry `code: sam_provider_error`, `provider_call_made: true`, and the reserved cost.

D1 stores the image hash, request-body hash, response hash, normalized result,
timestamp and charge. JPEG bytes and credentials are not stored. Unlike the
local Python audit, this hosted receipt does **not** retain original camera
images or raw provider text. It establishes hashes and normalized detections,
not a later replayable camera recording.

## Validation

`npm test` makes no network/model calls. It uses real SQLite connections for
atomic quota tests and the real official SAM mask decoder for contour tests.
The provider transport alone is mocked. Tests cover image/hidden-field
validation, exact provider payload, durable receipts, duplicate rejection,
failure costs, concurrent last-dollar reservations, monotonically imported
spend, per-run limits, unavailable configuration, disconnect settlement, and
stale-lease recovery without a refund. `npm run validate` imports
the complete built ESM artifact, checks static assets and verifies that private
paths remain absent and missing backend configuration fails closed.

Publication still needs one authorized real hosted observation to verify Meta
connectivity and D1 provisioning in production; local test results alone do not
claim that the hosted provider has run.
