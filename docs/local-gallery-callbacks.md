# Local gallery callbacks

A local gallery producer may receive only its gallery lifecycle callbacks on loopback. This is an operator-only server setting, not a general callback exception.

Add one entry per installed bot to the ClickClack server configuration:

```json
{
  "local_gallery_callbacks": [
    {
      "installation_id": "ins_example",
      "callback_url": "http://127.0.0.1:8791/gallery-actions"
    }
  ]
}
```

The URL must be exactly `http://127.0.0.1:<explicit-port>/gallery-actions`. DNS names, `localhost`, IPv6, HTTPS, paths other than `/gallery-actions`, credentials, query strings, fragments, duplicate installation IDs, and duplicate URLs fail startup. The exception is checked again for each delivery and applies only to `gallery_action.open`, `gallery_action.choices`, and `gallery_action.submit` for that installation. Mixed subscriptions do not gain loopback delivery for their non-gallery events. Slash-command callbacks and all other HTTP callbacks retain the public-address-only policy, proxy denial, redirect denial, and three-second timeout.

## Setup

1. Configure the gallery producer to bind the same explicit `127.0.0.1` port.
2. Add the exact installation and URL tuple above to the ClickClack serve configuration.
3. Restart ClickClack only after the producer is ready to accept signed callbacks.
4. Create the gallery event subscription with an authorized workspace-manager identity. Keep the signing secret in the producer configuration, not in this file.
5. Verify an open action reaches the producer and that an ordinary event subscription to the same local URL is rejected.

## Rollback

Stop the producer, remove its tuple from `local_gallery_callbacks`, restart ClickClack, then revoke the gallery event subscription and remove gallery actions using the producer's documented deregistration command. Do not merely remove the tuple while actions remain registered: ClickClack will retain the action surface but callbacks will fail closed.
