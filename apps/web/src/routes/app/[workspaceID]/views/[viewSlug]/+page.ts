export const prerender = false;
export const ssr = false;

import { error } from "@sveltejs/kit";

import { api, APIError } from "$lib/api";
import type { Workspace } from "$lib/types";
import { findWorkspaceView } from "$lib/views";

export async function load({ params }: { params: { workspaceID: string; viewSlug: string } }) {
  const view = findWorkspaceView(params.viewSlug);
  if (!view) throw error(404, "Unknown view");

  const workspaceID = params.workspaceID;
  let workspaces: Workspace[] = [];
  let loadError = "";
  try {
    const data = await api<{ workspaces: Workspace[] }>("/api/workspaces");
    workspaces = data.workspaces;
  } catch (err) {
    loadError =
      err instanceof APIError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Could not load workspace";
  }

  const workspace = workspaces.find((w) => w.id === workspaceID || w.route_id === workspaceID);
  // Resolve the component here rather than in the page so the view's own
  // failure to load is a load error, not a half-rendered shell.
  const component = (await view.load()).default;

  return { workspaceID, workspace, workspaces, loadError, view, component };
}
