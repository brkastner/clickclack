# Explicit desktop file access

**Status: Implemented in the task worktree and tested with isolated fixtures. Not deployed. Owner verification of the live file-manager interaction remains pending.**

## Goal and evidence

Implement explicit, authorized desktop-local link handling in ClickClack. Create
the Linear ticket first. Verify that the supplied video is accessible on the
Electron host before implementing this design; replan on contrary evidence. Do
not introduce HTTP filesystem serving or silently upload local files.

The user reports that OpenClaw file links return 404 because the app hostname is
prepended to an absolute filesystem path. The supplied failing URL is:

```text
https://athena.zorilla-puffin.ts.net:8080/home/kas/dev/claw/agents/kai/workspace/guildpodcast-generation/outputs/video-ready-2026-09-12/editorial/still-animatic-720p.mp4
```

Tracking: [KAS-894](https://linear.app/kashub/issue/KAS-894/fix-local-file-links-opening-as-clickclack-http-paths), created and retrieved before code implementation.

The running Electron application is on athena and uses the reported origin. The
supplied target is a regular file of 24,009,814 bytes, including when inspected
through that Electron process's filesystem root. An unauthenticated request to
the supplied URL returned HTTP 200 with `text/html; charset=utf-8`, not video.
The original persisted message syntax was not inspected.

The regression test initially demonstrated the actual desktop navigation handler
loading `/home/example/video.mp4` as an HTTP app page. It now passes without
navigation. The classifier supports positive `/home/<user>/...` and
`/Users/<user>/...` references, raw or under the exact configured origin. Other
filesystem syntaxes are not newly enabled.

## Implementation record

`apps/desktop/src/local-file-link.ts` owns classification and the result type.
Electron main owns exact-target confirmation, regular-file and identity checks,
and reveal. The isolated `app-preload.ts` handles trusted clicks and middle
clicks on existing `.markdown` links. This reuses the existing markup without
changing the web server or exposing a new callable filesystem method to page
JavaScript. The preload owns listeners for its document lifetime, so no web
component listeners require cleanup. Native context-menu actions use the same
main-process operation; redirects and `window.open` cannot invoke it.

Verification performed:

- `pnpm test:desktop`: 137 tests passed, including the red-to-green navigation
  regression and authorization tests.
- `pnpm --filter @clickclack/desktop typecheck`: passed.
- Scoped `oxlint` on changed desktop TypeScript: passed without warnings.
- `pnpm --filter @clickclack/desktop build`: passed.
- `node apps/desktop/scripts/smoke-local-file-links.mjs`: passed in real Electron
  using the built main and preload, a private profile, loopback fixture server,
  real temporary file, and trusted input. It covered cancellation, confirmed
  middle-click, keyboard activation, synthetic-event rejection, and normal route navigation. Native
  confirmation and OS reveal were recorded test boundaries, not real user
  approvals or actual file-manager launches.

Independent verification exposed a smoke-fixture focus race: a loaded DOM did
not mean the application view had native focus. The shared desktop display also
refused a subsequent explicit focus request. The Linux smoke now always uses its
own Xvfb display and requires native owner/view focus and a rendered frame before
sending input. The synthetic-event test prevents its own default navigation so
it cannot race the next trusted click. No timeout increase or retry was added.
This repairs the fixture, not application behavior. Linux smoke execution
requires `xvfb-run`; missing display tooling must fail rather than fall back to
the user's active display.

The isolated smoke can be rebuilt and repeated with
`pnpm --filter @clickclack/desktop smoke:local-files`. No live profile, server,
message, protocol registration, or source video is mutated by that fixture.
Packaging, live installation, and owner verification remain separate workflow
stages. The following selected steps retain the requirements against which the
implementation must be reviewed.

## Contracts and compatibility

- Keep web URLs, app routes, OAuth, deep links, and authenticated attachments
  unchanged. Only positively classified local references receive the new action.
- Add a narrow typed desktop request/result contract if existing capabilities
  cannot express the action. Return success, cancelled, unavailable, or denied;
  never return file bytes or arbitrary filesystem metadata.
- Local actions require a trusted main-frame caller, explicit user activation,
  and native confirmation of the exact target. Renderer input is not
  authorization.
- Interpret malformed app-origin links only for the exact configured origin and
  verified filesystem syntax. Reject ambiguous encodings, credentials, network
  paths, and unsupported schemes.
- No database or public HTTP API changes are planned. Older desktop versions and
  browser clients must not receive a falsely working local-file action.
- File reveal is the default safe local action, not automatic application
  execution. Do not claim in-app playback. If reveal does not satisfy the
  required interaction, replan rather than add an unreviewed execution
  capability.

## Implementation steps

### 1. Create the Linear ticket

**Location:** Linear, in the team/project owning ClickClack.

Create the requested issue with the supplied URL, observed 404, repository
ownership, and diagnosis-first scope. Record its identifier in workflow evidence
before implementation.

**Check:** Retrieve the issue and verify its title, repository context, and
reproduction URL.

### 2. Establish the failing path and file host

**Location:** `apps/web/src/lib/actions/markdown.ts`,
`apps/desktop/src/main.ts`, the representative message, and the Electron runtime.

Trace raw message href, rendered href, and navigation handling. Verify host
identity and accessibility of only the supplied target without editing its
source repository. Record whether opening in the file manager meets the intended
interaction. Stop for replanning if desktop-local access cannot solve the case.

**Check:** Capture the failing navigation and confirmed file-host relationship.
Do not substitute the coding host's file existence for evidence about the
Electron host.

### 3. Define classification and results

**Location:** `apps/desktop/src/contract.ts` and a focused local-file-link helper
beside it.

Define a pure classifier and typed action result. Keep ordinary routes distinct
from explicit local references. Support only diagnosed syntax and exact
configured-origin recovery; do not hardcode the sample hostname or filename.

**Check:** Table-driven tests distinguish the supplied malformed URL from valid
app paths, external URLs, encoded traversal, ambiguous encoding, and network
paths.

### 4. Add the authorized reveal action

**Location:** `apps/desktop/src/main.ts`.

Implement the narrow local reveal handler with trusted-caller checks, native
confirmation, canonical-path validation, regular-file checks, and explicit
failure results. Keep confirmation bound to the exact target. Do not add shell
commands, automatic `openPath` execution, or renderer-accessible unrestricted
filesystem methods.

**Check:** The main-process harness proves denial for untrusted callers,
cancellation, invalid paths, and target changes. Successful authorization reveals
only the confirmed file.

### 5. Connect supported message links

**Location:** `apps/desktop/src/app-preload.ts`,
`apps/web/src/lib/actions/markdown.ts`, and existing desktop bridge typings.

Expose only the typed action and connect positively classified message links to
it. Prevent the erroneous HTTP navigation for those links, display action
failures, and preserve keyboard activation and cleanup. Feature-detect the
capability for older clients.

**Check:** Integration tests show that a supported click invokes one authorized
action without loading the malformed HTTP URL. Normal links and older-client
behavior remain unchanged.

### 6. Cover alternative link-opening paths

**Location:** Navigation and context-menu handlers in `apps/desktop/src/main.ts`.

Apply the same classification consistently to supported explicit link entry
points so middle-click and context-menu handling cannot bypass the policy. Keep
redirects from triggering local actions and preserve OAuth and deep-link guards.

**Check:** Harness tests cover normal click, new-window requests, context-menu
actions, redirects, and non-main-frame attempts.

### 7. Verify the regression and security boundaries

**Location:** `apps/desktop/src/contract.test.ts`,
`apps/desktop/scripts/main.test.mjs`, focused web tests, and Electron verification.

Add regression coverage for the observed failure and permission boundaries. Run
relevant desktop/web checks, then exercise the supplied video in Electron with
explicit user confirmation.

**Check:** Record passing commands and Electron evidence of access to the intended
file with no filesystem-path HTTP request. An unavailable message alone is not a
passing reproduction.

### 8. Record rollout state

**Location:** Workflow deployment stage and Linear issue.

Follow the applicable desktop and openclaw-deploy skill checks before any
live-readiness claim. No data migration is needed. Record verification and
rollout state; revert the application change if navigation regressions occur.

**Check:** Report implemented and tested until deployment checks pass. Update the
ticket with actual results and unresolved limitations, not inferred completion.

## Test coverage

- **Classifier:** Supplied URL, explicit supported local syntax, spaces, Unicode,
  malformed escapes, traversal, credentials, foreign origin, network paths, and
  valid app routes.
- **Authorization:** Untrusted frames, stale windows, cancellation, denied
  access, directories, missing files, symlink/target changes, and repeated
  requests.
- **Compatibility:** Ordinary HTTPS links, OAuth, deep links, attachments,
  absent desktop capability, keyboard activation, and listener cleanup.
- **Navigation:** No HTTP request for the confirmed local action. Redirects and
  alternative link-opening paths cannot bypass authorization.
- **Electron:** Access the intended video on the verified desktop host, then
  demonstrate clear failure for missing or denied targets.

## Risks and handling

| Risk                                                        | Mitigation                                                                                                                              |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| The video exists only on the OpenClaw host.                 | Make host/file verification a prerequisite. Replan from evidence; do not add remote file serving or claim a disabled link fixes access. |
| An app route is mistaken for a filesystem path.             | Use conservative positive classification, preserve valid route namespaces, and reject ambiguity.                                        |
| Agent-authored links trigger privileged local access.       | Require native confirmation and trusted-caller validation in the main process; never execute link content.                              |
| Reveal differs from the expected video-opening interaction. | Validate the interaction before implementation. Keep access and playback claims distinct and replan if reveal is insufficient.          |

## Boundaries

- No OpenClaw, pi-clickclack, Tailscale, DNS, or sibling-repository changes.
- No arbitrary HTTP file endpoint, new service, broad filesystem browsing, or
  automatic upload.
- No database migration or generated SQL edits.
- This plan does not assert verified desktop file availability or grant broader
  filesystem permissions.

The canonical specification is [SPEC.md](../../SPEC.md#explicit-desktop-file-access).
Current desktop documentation describes shipped behavior; this selected plan
does not claim its proposed capability is already available.
