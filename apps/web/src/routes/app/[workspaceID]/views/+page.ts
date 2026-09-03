export const prerender = false;
export const ssr = false;

import { redirect } from "@sveltejs/kit";

import { DEFAULT_WORKSPACE_VIEW, workspaceViewsPath } from "$lib/views";

export function load({ params }: { params: { workspaceID: string } }) {
  throw redirect(307, workspaceViewsPath(params.workspaceID, DEFAULT_WORKSPACE_VIEW));
}
