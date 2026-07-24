---
read_when:
  - changing channel pins or pinned-message events
---

# Pinned messages

Channel members can pin up to 100 non-deleted messages in a channel. Pins are shared channel
state, not a per-user bookmark. Direct messages do not support pins.

## Endpoints

```http
GET    /api/channels/{channel_id}/pins
POST   /api/channels/{channel_id}/pins
DELETE /api/channels/{channel_id}/pins/{message_id}
```

The POST body is `{ "message_id": "msg_..." }`. Listing returns full message objects newest pin
first. A duplicate pin or a channel at its limit returns HTTP 409.

## Events

- `pin.added` after a message is pinned
- `pin.removed` after a message is unpinned

Both events carry `channel_id`, `message_id`, and `pinned_by` in their payload so connected clients
can refresh the shared panel.
