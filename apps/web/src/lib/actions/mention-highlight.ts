import type { User } from "../types";

export type MentionRange = {
  start: number;
  end: number;
  handle: string;
};

export type MentionHighlightOptions = {
  people?: User[];
  attentionUserID?: string;
};

const MENTION_RE = /(^|[^\p{L}\p{N}_@-])(@[\p{L}\p{N}][\p{L}\p{N}_-]{0,31})/gu;

export function mentionTargets(people: readonly User[]): Map<string, User> {
  const targets = new Map<string, User>();
  for (const person of people) {
    const handle = person.handle?.trim().toLowerCase();
    if (handle && !person.deleted_at) targets.set(handle, person);
  }
  return targets;
}

export function findMentionRanges(text: string, handles: ReadonlySet<string>): MentionRange[] {
  const ranges: MentionRange[] = [];
  for (const match of text.matchAll(MENTION_RE)) {
    const prefix = match[1] ?? "";
    const token = match[2] ?? "";
    const handle = token.slice(1).toLowerCase();
    const start = match.index + prefix.length;
    if (!handles.has(handle) || mentionIsInsideURL(text, start)) continue;
    ranges.push({ start, end: start + token.length, handle });
  }
  return ranges;
}

function mentionIsInsideURL(text: string, start: number): boolean {
  const tokenStart =
    Math.max(text.lastIndexOf(" ", start - 1), text.lastIndexOf("\n", start - 1)) + 1;
  const prefix = text.slice(tokenStart, start);
  return (
    /^(?:www\.[^\s/]+|[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/]+)\//u.test(prefix) ||
    /(?:^|\/)[^\s/]*\/$/u.test(prefix)
  );
}

function clearMentionHighlights(root: HTMLElement) {
  for (const highlight of root.querySelectorAll<HTMLElement>("[data-clickclack-mention]")) {
    highlight.replaceWith(root.ownerDocument.createTextNode(highlight.textContent ?? ""));
  }
}

function isExcludedTextNode(node: Text): boolean {
  return Boolean(node.parentElement?.closest("a, code, pre, script, style, textarea"));
}

function renderMentionHighlights(
  root: HTMLElement,
  targets: Map<string, User>,
  attentionUserID: string,
) {
  clearMentionHighlights(root);
  if (targets.size === 0) return;

  const walker = root.ownerDocument.createTreeWalker(root, 4);
  const textNodes: Text[] = [];
  let current: Node | null;
  while ((current = walker.nextNode())) {
    if (current instanceof Text && !isExcludedTextNode(current)) textNodes.push(current);
  }

  for (const textNode of textNodes) {
    const ranges = findMentionRanges(textNode.data, new Set(targets.keys()));
    if (ranges.length === 0) continue;

    const fragment = root.ownerDocument.createDocumentFragment();
    let cursor = 0;
    for (const range of ranges) {
      fragment.append(textNode.data.slice(cursor, range.start));
      const target = targets.get(range.handle);
      const highlight = root.ownerDocument.createElement("mark");
      highlight.className = "message-mention";
      highlight.dataset.clickclackMention = "true";
      highlight.dataset.mentionHandle = range.handle;
      if (target?.id) highlight.dataset.mentionUserId = target.id;
      if (target?.id && target.id === attentionUserID) {
        highlight.classList.add("is-current-user");
        highlight.dataset.mentionAttention = "true";
      }
      highlight.title = target?.display_name || `@${range.handle}`;
      highlight.textContent = textNode.data.slice(range.start, range.end);
      fragment.append(highlight);
      cursor = range.end;
    }
    fragment.append(textNode.data.slice(cursor));
    textNode.replaceWith(fragment);
  }
}

export function enhanceMentions(node: HTMLElement, options: MentionHighlightOptions = {}) {
  let targets = mentionTargets(options.people ?? []);
  let attentionUserID = options.attentionUserID ?? "";
  let observer: MutationObserver | undefined;

  const render = () => {
    observer?.disconnect();
    renderMentionHighlights(node, targets, attentionUserID);
    observer?.observe(node, { childList: true, subtree: true });
  };

  observer = new MutationObserver(() => render());
  render();

  return {
    update(nextOptions: MentionHighlightOptions = {}) {
      targets = mentionTargets(nextOptions.people ?? []);
      attentionUserID = nextOptions.attentionUserID ?? "";
      render();
    },
    destroy() {
      observer?.disconnect();
    },
  };
}
