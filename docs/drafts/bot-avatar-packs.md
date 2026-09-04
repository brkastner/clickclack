# Proposed bot avatar packs

**Status: Proposed, not implemented.** This document preserves planning work from
run `6b5c54cb`. It is not a description of supported configuration or a published
API contract. No avatar-pack code or images are included. The workflow could not
be finalized because its status operation returned `FOREIGN KEY constraint failed`.
Committing this proposal does not complete that workflow.

The proposed feature lets a viewer replace every bot's displayed avatar with an
image from an operator-provided pack. It would be a per-account appearance
preference, not a change to bot identity or workspace settings. Existing behavior
is documented in [Bots](../features/bots.md) and
[Configuration](../configuration.md).

## Proposed configuration and storage

- Add `--avatar-packs-dir` / `CLICKCLACK_AVATAR_PACKS_DIR`, defaulting to
  `<data>/avatar-packs`.
- Each immediate subdirectory would be one pack, named after that directory.
- Allow `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, and `.avif` images only.
  Ignore other files when listing and reject them when serving.
- Cap each pack's listing at a server-defined maximum. The limit remains to be
  chosen.
- Ship no images. A missing, unconfigured, or unreadable root would yield empty
  listings rather than an error. The settings control would be disabled, explain
  the configured directory, and leave normal bot avatars in place.

Illustrative setup, usable only after implementation:

```sh
export CLICKCLACK_AVATAR_PACKS_DIR=/var/lib/clickclack/avatar-packs
mkdir -p "$CLICKCLACK_AVATAR_PACKS_DIR/crustacean"
cp ./*.png "$CLICKCLACK_AVATAR_PACKS_DIR/crustacean/"
```

The root would be read-only to the API. Operators should not point it at a
location containing other files they do not intend to serve.

## Proposed display and preference behavior

Appearance settings would expose an SFW/NSFW toggle and a pack picker. SFW would
be the default and mean no override. These labels would not classify, moderate,
or age-gate image content. Their mapping to pack names needs clarification before
implementation.

The optional `bot_avatar_pack` string would roam with the account across devices,
including during screen sharing. Empty would mean off. Writes would trim the
value, enforce a 128-character maximum, and reject path separators and `..`.
Omitting the field on update would preserve its stored value. An unknown pack
name would be accepted and resolve to an empty list.

The override would apply only to bots. It would never write `avatar_url` or
`avatar_url_light`, alter identity-sync behavior, or affect human avatars.

Clients would hash each bot's user ID and index into the sorted file list. The
same bot would keep its assignment across re-renders, navigation, and reloads
while the directory is unchanged. Adding or removing files could reassign every
bot. There would be no per-bot image pinning. The hash algorithm remains to be
specified.

No selected pack, an empty or unknown pack, or a failed listing request would
fall back to the bot's normal stored avatar.

**Open decision: image-load fallback.** The original planning text conflicts:
one passage says every image-load failure falls back to the stored avatar,
while another says a pack image returning 404 goes directly to the normal
initial-and-hue placeholder. Neither behavior is selected here. Decide the
fallback chain, including failure of the stored avatar, before implementing it.

## Proposed API and security

The three read-only routes below would use the same authentication as
`/api/uploads`. Images would remain on the client's existing `/api` origin,
without user-entered or cross-origin URLs. The exact authorization policy needs
implementation review rather than assuming that authentication alone gives
upload-equivalent access control.

Pack names and file names containing a path separator, NUL byte, or `..` would
be rejected before disk access. Resolved paths would stay inside the configured
root, and symlinks pointing outside it would not be followed. Disallowed image
extensions would return 404. Image Content-Type would come from the extension.

Both listings would be sorted. File listings would return ready-to-use image
URLs rather than bare filenames, retaining the client contract if storage later
moves away from the filesystem. Stable ordering is part of the selection
contract. Unknown packs would return 200 with an empty file list.

The following is a **noncanonical OpenAPI fragment**, not a complete OpenAPI
document. The appearance schemas show proposed property additions only; they do
not replace the existing schemas in `packages/protocol/openapi.yaml`.

```yaml
paths:
  /api/avatar-packs:
    get:
      operationId: listAvatarPacks
      description: Proposed authenticated listing; absent or unreadable roots return an empty list.
      responses:
        "200":
          description: Available pack names, sorted
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/AvatarPackListResponse"
  /api/avatar-packs/{pack}:
    get:
      operationId: listAvatarPackFiles
      description: Proposed authenticated listing of sorted image URLs; unknown packs return an empty list.
      parameters:
        - name: pack
          in: path
          required: true
          description: Must not contain a path separator, NUL byte, or "..".
          schema:
            type: string
      responses:
        "200":
          description: Allowlisted image URLs, sorted and capped at a server-defined maximum
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/AvatarPackFilesResponse"
  /api/avatar-packs/{pack}/{file}:
    get:
      operationId: getAvatarPackFile
      description: Proposed authenticated image serving with root containment and extension checks.
      parameters:
        - name: pack
          in: path
          required: true
          schema:
            type: string
        - name: file
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Image bytes with Content-Type derived from the extension
        "404":
          description: Unknown pack or file, disallowed extension, or rejected path
components:
  schemas:
    AppearancePreferences:
      type: object
      properties:
        bot_avatar_pack:
          type: string
          maxLength: 128
          description: Proposed per-account bot display override. Empty means off; unknown packs fall back to stored avatars.
    AppearancePreferencesPatch:
      type: object
      properties:
        bot_avatar_pack:
          type: string
          maxLength: 128
          description: Proposed pack name; empty disables, omission preserves. Trim and reject path separators and "..".
    AvatarPackListResponse:
      type: object
      required: [packs]
      properties:
        packs:
          type: array
          description: Pack names, sorted.
          items:
            type: string
    AvatarPackFilesResponse:
      type: object
      required: [files]
      properties:
        files:
          type: array
          description: Sorted, stable URLs of the form /api/avatar-packs/{pack}/{file}.
          items:
            type: string
```

## Required validation before implementation can ship

- Test configuration defaults and overrides, absent and unreadable roots, unknown
  packs, sorted URL listings, extension filtering, and listing bounds.
- Test authenticated and unauthorized requests, path traversal, encoded separators,
  NUL bytes, symlink escapes, root containment, and response Content-Type. Define
  invalid-name responses for listing routes and confirm safe URL encoding.
- Test preference trimming, length limits, rejected names, empty and omitted
  values, account roaming, and unchanged bot identities and human avatars.
- Specify and test a deterministic hash, unchanged-directory stability, and
  reassignment after directory edits.
- Resolve and test the image-failure fallback chain and toggle/pack relationship.
- Verify settings, bot avatar surfaces, light avatars, and failure behavior in
  Electron. Confirm empty-root explanatory text and disabled controls.
- Implement and test the API before adding these paths and properties to the
  canonical OpenAPI contract and generating SDK types.
