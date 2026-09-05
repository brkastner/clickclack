import type { components } from "../../../../../packages/sdk-ts/src/generated/openapi";
import type { WorkflowRun } from "./workflow-run";

export type WorkflowSnapshot = components["schemas"]["WorkflowSnapshot"];
export type WorkflowRunRecord = components["schemas"]["WorkflowRunRecord"];
export type WorkflowRunPage = components["schemas"]["WorkflowRunPage"];
export type WorkflowFiles = components["schemas"]["WorkflowFiles"];

/** Server record IDs already namespace producer, target, provider, session and run. */
export function mergeWorkflowRecords(
  current: readonly WorkflowRunRecord[],
  incoming: readonly WorkflowRunRecord[],
): WorkflowRunRecord[] {
  const records = new Map(current.map((record) => [record.id, record]));
  for (const record of incoming) {
    const previous = records.get(record.id);
    if (!previous || record.snapshot.source.revision > previous.snapshot.source.revision) {
      records.set(record.id, record);
    }
  }
  return [...records.values()].sort((a, b) => b.id.localeCompare(a.id));
}

export function snapshotRun(record: WorkflowRunRecord): WorkflowRun {
  return {
    ...record.snapshot.run,
    runId: record.snapshot.source.runId,
    steps: record.snapshot.steps,
    live: false,
  };
}

export type WorkflowFileNode = {
  name: string;
  path: string;
  children: WorkflowFileNode[];
  entry?: WorkflowFiles["entries"][number];
};

/** Build only a display tree. These paths are never opened, fetched or executed. */
export function workflowFileTree(files: WorkflowFiles): WorkflowFileNode[] {
  const roots: WorkflowFileNode[] = [];
  for (const entry of files.entries) {
    let siblings = roots;
    let path = "";
    for (const part of entry.path.split("/")) {
      path = path ? `${path}/${part}` : part;
      let node = siblings.find((candidate) => candidate.name === part);
      if (!node) {
        node = { name: part, path, children: [] };
        siblings.push(node);
      }
      if (path === entry.path) node.entry = entry;
      siblings = node.children;
    }
  }
  const sort = (nodes: WorkflowFileNode[]) => {
    nodes.sort(
      (a, b) =>
        Number(b.children.length > 0) - Number(a.children.length > 0) ||
        a.name.localeCompare(b.name),
    );
    for (const node of nodes) sort(node.children);
  };
  sort(roots);
  return roots;
}
