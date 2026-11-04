# TWINFORGE private live SAM Worker

This self-contained Worker serves the current public frontend and implements
`GET /api/sam/status` and `POST /api/sam/segment`. SAM 3.1 receives the exact JPEG
and the object concept. Source identity/time remain in the local receipt; no
simulator seed, positions, velocities, masses or forces are accepted.

The official `@meta-sam/parser` decodes each provider mask. Foreground pixels
produce the centroid and area; their JPEG colors produce the median color.
The endpoint never creates a local segmentation fallback. It returns the same
`twinforge.sam.frame.v1` observation contract as the Python runtime.

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
  reserved locally), leaving at most $0.40 for hosted SAM. This is an allocation,
  not a claim that $0.10 was already spent.

Missing configuration or missing D1 storage disables paid calls. The initial
spend is persisted in D1; subsequent configuration can increase it but cannot
lower it. The hard global ceiling is 5000 units ($0.50), every image reserves
25 units ($0.0025), and each run permits at most 60 paid requests. A new random
scene, a Worker restart or a different phone cannot reset the shared ceiling.

The paired local server uses `TWINFORGE_LIVE_SAM_BUDGET_USD=0.10`, including
all existing local vision charges. The hosted baseline reserves that entire
local share and leaves $0.40, so the two live services together cannot exceed
$0.50. Changing random trials or redeploying cannot reset either share. Do not
raise the local share without reserving the increase in D1 first. The Worker
cannot observe subsequent changes to local environment configuration.

All quota predicates are in one conditional D1/SQLite `INSERT`. The database
also enforces unique `(run_id, frame_id)` pairs. A reservation is retained even
if Meta fails or the request is interrupted. One provider request can be in flight;
an abandoned slot becomes available after 180 seconds but its dollars remain
charged. Only the rejected busy path returns `code: sam_busy`,
`provider_call_made: false`, and `retry_after_s: 1`; budget/run limits never do.

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
spend, per-run limits and unavailable configuration. `npm run validate` imports
the complete built ESM artifact, checks static assets and verifies that private
paths remain absent and missing backend configuration fails closed.

Publication still needs one authorized real hosted observation to verify Meta
connectivity and D1 provisioning in production; local test results alone do not
claim that the hosted provider has run.
