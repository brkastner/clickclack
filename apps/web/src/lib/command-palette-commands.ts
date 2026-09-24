// Builders for the palette's built-in commands. Each surface that owns some
// state (the workspace layout, chat, the settings pages) calls these with what
// it knows, so the same command reads the same way wherever it's offered.

import { channelDisplayTitle } from "./chat/channels.ts";
import { dmTitle, userDisplayLabel } from "./chat/people.ts";
import type { PaletteCommand } from "./command-palette.ts";
import { isWorkspaceManager, type WorkspaceRole } from "./permissions.ts";
import {
  ACCOUNT_SETTINGS_SECTIONS,
  WORKSPACE_SETTINGS_SECTIONS,
  workspaceSettingsPath,
  type AccountSettingsSectionId,
} from "./settings.ts";
import type { Channel, DirectConversation } from "./types.ts";
import { WORKSPACE_VIEWS, workspaceViewsPath } from "./views.ts";

// Receives an href, or a conversation id when the caller routes by id.
export type Navigate = (target: string) => void | Promise<void>;

export const PALETTE_ICONS = {
  plus: ["M12 5v14", "M5 12h14"],
  message: ["M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"],
  sidebar: ["M4 4h16v16H4z", "M9 4v16"],
  sun: [
    "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z",
    "M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42",
  ],
  moon: ["M21 12.8A8.5 8.5 0 1 1 11.2 3 6.7 6.7 0 0 0 21 12.8Z"],
  user: ["M20 21a8 8 0 0 0-16 0", "M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"],
  tangent: [
    "M6 3v12",
    "M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
    "M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
    "M18 9a9 9 0 0 1-9 9",
  ],
};

/** Home, gallery, and any other registered workspace view. */
export function viewCommands(
  workspaceRouteID: string,
  currentPath: string,
  navigate: Navigate,
): PaletteCommand[] {
  return WORKSPACE_VIEWS.map((view) => {
    const href = workspaceViewsPath(encodeURIComponent(workspaceRouteID), view.slug);
    return {
      id: `view:${view.id}`,
      label: view.label.charAt(0).toUpperCase() + view.label.slice(1),
      group: "navigation" as const,
      keywords: view.description ? [view.description] : undefined,
      icon: view.icon,
      current: currentPath === href,
      run: () => navigate(href),
    };
  });
}

/** Workspace settings pages this person can open. */
export function workspaceSettingsCommands(
  workspaceRouteID: string,
  role: WorkspaceRole | undefined | null,
  currentPath: string,
  navigate: Navigate,
): PaletteCommand[] {
  const manager = isWorkspaceManager(role);
  return WORKSPACE_SETTINGS_SECTIONS.filter((section) => !section.managersOnly || manager).map(
    (section) => {
      const href = workspaceSettingsPath(encodeURIComponent(workspaceRouteID), section.slug);
      return {
        id: `workspace-settings:${section.id}`,
        label: `Workspace settings: ${section.label}`,
        group: "settings" as const,
        keywords: ["workspace", section.label],
        icon: section.icon,
        current: currentPath === href,
        run: () => navigate(href),
      };
    },
  );
}

/** Sections of the account settings dialog. */
export function accountSettingsCommands(
  open: (section: AccountSettingsSectionId) => void,
): PaletteCommand[] {
  return ACCOUNT_SETTINGS_SECTIONS.map((section) => ({
    id: `account-settings:${section.id}`,
    label: `Account settings: ${section.label}`,
    group: "settings" as const,
    keywords: ["preferences", "account", section.label],
    icon: PALETTE_ICONS.user,
    run: () => open(section.id),
  }));
}

export function channelCommands(
  channels: Channel[],
  targetForChannel: (channel: Channel) => string,
  currentChannelID: string,
  navigate: Navigate,
): PaletteCommand[] {
  return channels
    .filter((channel) => !channel.archived_at)
    .map((channel) => {
      const title = channelDisplayTitle(channel);
      return {
        id: `channel:${channel.id}`,
        label: title,
        group: "channels" as const,
        // The slug still matches after a channel is renamed.
        keywords: title === channel.name ? undefined : [channel.name],
        glyph: "#",
        hint: channel.unread_count ? `${channel.unread_count} unread` : undefined,
        current: channel.id === currentChannelID,
        run: () => navigate(targetForChannel(channel)),
      };
    });
}

export function renameChannelCommands(
  channel: Channel | undefined,
  canManageChannels: boolean,
  openRename: (channelID: string) => void,
): PaletteCommand[] {
  if (!channel || !canManageChannels) return [];
  return [
    {
      id: "action:rename-channel",
      label: "rename channel",
      group: "actions",
      keywords: [
        "edit channel name",
        "change channel title",
        channel.name,
        channelDisplayTitle(channel),
      ],
      hint: `#${channelDisplayTitle(channel)}`,
      glyph: "#",
      run: () => openRename(channel.id),
    },
  ];
}

export function directCommands(
  conversations: DirectConversation[],
  currentUserID: string,
  targetForDirect: (conversation: DirectConversation) => string,
  currentDirectID: string,
  navigate: Navigate,
): PaletteCommand[] {
  return conversations.map((conversation) => {
    const others = conversation.members.filter((member) => member.id !== currentUserID);
    return {
      id: `direct:${conversation.id}`,
      label: dmTitle(conversation, currentUserID),
      group: "directs" as const,
      keywords: [
        "dm",
        ...others.map((member) => member.handle ?? "").filter(Boolean),
        ...others.map((member) => userDisplayLabel(member)),
      ],
      glyph: "@",
      hint: conversation.unread_count ? `${conversation.unread_count} unread` : undefined,
      current: conversation.id === currentDirectID,
      run: () => navigate(targetForDirect(conversation)),
    };
  });
}

export function themeCommand(
  resolvedMode: "light" | "dark",
  setMode: (mode: "light" | "dark") => void,
): PaletteCommand {
  const target = resolvedMode === "light" ? "dark" : "light";
  return {
    id: "action:toggle-theme",
    label: `Switch to ${target} mode`,
    group: "actions",
    keywords: ["theme", "toggle theme", "dark mode", "light mode", "appearance"],
    icon: target === "dark" ? PALETTE_ICONS.moon : PALETTE_ICONS.sun,
    run: () => setMode(target),
  };
}
