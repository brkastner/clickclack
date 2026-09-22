<script lang="ts">
  import Sidebar from "../../../src/components/navigation/Sidebar.svelte";
  import { resolvedColorMode } from "../../../src/lib/appearance";
  import type { User, Channel } from "../../../src/lib/types";
  let workspaceID = $state("wsp_one");
  let selectedChannelID = $state("chn_one");
  let selectedDirectID = $state("");
  let events = $state<string[]>([]);
  const noop = () => {};
  const person = (id: string, name: string): User => ({ id, kind: "bot", display_name: name, handle: id, avatar_url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='400'%3E%3Crect width='200' height='400' fill='%239ccfd8'/%3E%3C/svg%3E", created_at: "2026-01-01T00:00:00Z" });
  const people = [person("bot_one", "Alpha"), person("bot_two", "Beta"), person("bot_empty", "Empty")];
  const currentUser: User = { ...person("human", "Owner"), kind: "human" };
  const profiles = people.map(p => ({ ...p, bot_user_id: p.id, unread_count: 0 }));
  let channels = $state<Channel[]>([
    { id: "chn_one", route_id: "r_one", workspace_id: "wsp_one", name: "first", kind: "public", created_at: "2026-01-01", external_managed: false, bot_assignments: [{ channel_id: "chn_one", bot_user_id: "bot_one" }] },
    { id: "chn_two", route_id: "r_two", workspace_id: "wsp_one", name: "second", kind: "public", created_at: "2026-01-01", external_managed: false, unread_count: 2, bot_assignments: [{ channel_id: "chn_two", bot_user_id: "bot_two" }] },
    { id: "chn_three", route_id: "r_three", workspace_id: "wsp_one", name: "third", kind: "public", created_at: "2026-01-01", external_managed: false, bot_assignments: [{ channel_id: "chn_three", bot_user_id: "bot_two" }] },
  ]);
  const selectChannel = (id: string) => { events.push(`channel:${id}`); selectedChannelID = id; selectedDirectID = ""; };
  const selectDirect = (id: string) => { events.push(`direct:${id}`); selectedDirectID = id; };
</script>
<div class="fixture-controls">
  <button onclick={() => channels = channels.map(c => c.id === "chn_one" ? { ...c, archived_at: c.archived_at ? undefined : "2026-01-02" } : c)}>Toggle Alpha channel archive</button>
  <button onclick={() => events = []}>Clear events</button>
  <button onclick={() => workspaceID = workspaceID === "wsp_one" ? "wsp_two" : "wsp_one"}>Switch workspace</button>
  <button onclick={() => resolvedColorMode.set("light")}>Light</button>
  <button onclick={() => resolvedColorMode.set("dark")}>Dark</button>
  <output data-testid="events">{JSON.stringify(events)}</output>
  <output data-testid="selection">{selectedChannelID}/{selectedDirectID}</output>
</div>
<div style="height: 320px; width: 320px" data-testid="sidebar-shell">
<Sidebar {workspaceID} {currentUser} {channels} {selectedChannelID} {selectedDirectID}
  workspaces={[]} createWorkspaceName="" showWorkspaceCreate={false} connected={true} showHeader={false}
  directConversations={[{ id: "dm_one", route_id: "d_one", workspace_id: workspaceID, created_at: "2026-01-01", members: [currentUser, people[0]], unread_count: 3, can_send: true }]}
  workingConversationIDs={new Set()} recentPeople={people} profilePeople={people} profileShortcuts={profiles} selectedProfile={null}
  hrefForWorkspace={(id) => `#workspace-${id}`} hrefForChannel={(id) => `#channel-${id}`} hrefForDirect={(id) => `#dm-${id}`}
  onSelectChannel={selectChannel} onSelectDirect={selectDirect} onStartDirect={(id) => events.push(`start:${id}`)}
  onCreateChannel={(profile) => events.push(`create:${profile?.bot_user_id}`)}
  onAssignChannelProfile={(id, profile) => events.push(`assign:${id}:${profile?.bot_user_id ?? "none"}`)}
  canManageChannels={true} onArchiveChannel={(id) => events.push(`archive:${id}`)}
  onCreateDirect={() => events.push("create-direct")} onHideDirect={noop} onUndoHideDirect={noop}
  onOpenProfile={noop} onOpenSettings={noop} onSelectWorkspace={noop} onToggleWorkspaceCreate={noop}
  onWorkspaceName={noop} onCreateWorkspace={noop} onOpenWorkspaceSettings={noop} />
</div>

<style>
  :global(.sidebar) { height: 320px; }
</style>
