import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parsePersonaChannelPins, pinnedPersonaChannel } from "./personaNavigation.ts";
import type { Channel } from "./types.ts";

function channel(id: string, personaID: string, overrides: Partial<Channel> = {}): Channel {
  return {
    id,
    route_id: `route_${id}`,
    workspace_id: "wrk_1",
    name: id,
    kind: "public",
    created_at: "2026-09-02T00:00:00Z",
    external_managed: false,
    bot_assignments: [{ channel_id: id, bot_user_id: personaID }],
    ...overrides,
  };
}

test("parses persona channel pins from bounded storage", () => {
  assert.deepEqual(parsePersonaChannelPins('{"kai":"chn_1"}'), { kai: "chn_1" });
  assert.deepEqual(parsePersonaChannelPins("not json"), {});
  assert.deepEqual(parsePersonaChannelPins('["chn_1"]'), {});
});

test("resolves a pin only while the channel still belongs to that persona", () => {
  const channels = [channel("chn_kai", "kai"), channel("chn_liz", "liz")];

  assert.equal(pinnedPersonaChannel({ kai: "chn_kai" }, "kai", channels)?.id, "chn_kai");
  assert.equal(pinnedPersonaChannel({ kai: "chn_liz" }, "kai", channels), undefined);
  assert.equal(
    pinnedPersonaChannel({ kai: "chn_kai" }, "kai", [
      channel("chn_kai", "kai", { archived_at: "2026-09-02T00:01:00Z" }),
    ]),
    undefined,
  );
});

test("channel context menu exposes Pin and persona shelf clicks prefer the pinned channel", () => {
  const channelList = readFileSync(
    new URL("../components/navigation/ChannelList.svelte", import.meta.url),
    "utf8",
  );
  const sidebar = readFileSync(
    new URL("../components/navigation/Sidebar.svelte", import.meta.url),
    "utf8",
  );

  assert.match(
    channelList,
    /oncontextmenu=\{\(event\) => void openChannelContextMenu\(event, channel\)\}/u,
  );
  assert.match(channelList, />Pin<\/button>/u);
  assert.match(sidebar, /pinnedPersonaChannel\(personaChannelPins, person\.id, channels\)/u);
  assert.match(sidebar, /onSelectChannel\(pinnedChannel\.id\)/u);
});
