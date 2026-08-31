import type { RealtimeEvent, User } from "./types";

export type AgentWorkingSignal = "start" | "stop";

export type AgentWorkingTurn = {
  key: string;
  turnID: string;
  userID: string;
};

export type PendingAgentSend = {
  id: string;
  agentIDs: string[];
  correlated: boolean;
};

export type CompletedAgentTurn = {
  turnID: string;
  userID: string;
};

export type ConversationAgentWork = {
  pendingSends: PendingAgentSend[];
  turns: AgentWorkingTurn[];
  // Correlated completion can beat the send response or be followed by delayed
  // progress. Keep a bounded, identity-aware tombstone set for both races.
  completedTurns: CompletedAgentTurn[];
};

export type ConversationAgentWorkAction =
  | { type: "pending.start"; sendID: string; agentIDs: string[] }
  | { type: "pending.replace"; sendID: string; replacementID: string }
  | { type: "pending.fail"; sendID: string }
  | { type: "progress.start"; turn: AgentWorkingTurn }
  | { type: "progress.stop"; turn: AgentWorkingTurn }
  | { type: "response.final"; turnID?: string; userID: string };

export function realtimeConversationID(event: RealtimeEvent): string {
  const payload = event.payload as Record<string, unknown>;
  const directConversationID =
    typeof payload.direct_conversation_id === "string" ? payload.direct_conversation_id : "";
  return directConversationID || event.channel_id || "";
}

export function agentProgressWorkingSignal(event: RealtimeEvent): AgentWorkingSignal | null {
  if (event.type !== "agent.progress") return null;
  const payload = event.payload as Record<string, unknown>;
  const op = typeof payload.op === "string" ? payload.op : "";
  if (op === "append" || op === "update" || op === "finalize") return "start";
  if (op === "clear") return "stop";
  return null;
}

export function isFinalAgentMessageEvent(event: RealtimeEvent, author: User | undefined): boolean {
  if (event.type !== "message.created" && event.type !== "thread.reply_created") return false;
  const payload = event.payload as Record<string, unknown>;
  const kind = typeof payload.kind === "string" ? payload.kind : "message";
  if (kind !== "message") return false;
  // The API accepts turn_id on ordinary messages only from bot-token callers,
  // so correlated finals remain trustworthy before the user roster is loaded.
  const turnID = typeof payload.turn_id === "string" ? payload.turn_id : "";
  return author?.kind === "bot" || Boolean(turnID);
}

export function reduceConversationAgentWork(
  current: ConversationAgentWork | undefined,
  action: ConversationAgentWorkAction,
): ConversationAgentWork | undefined {
  const pendingSends = (current?.pendingSends ?? []).map((send) => ({
    ...send,
    agentIDs: [...send.agentIDs],
  }));
  const turns = [...(current?.turns ?? [])];
  const completedTurns = (current?.completedTurns ?? []).map((turn) => ({ ...turn }));

  switch (action.type) {
    case "pending.start":
      if (action.sendID && !pendingSends.some((send) => send.id === action.sendID)) {
        pendingSends.push({
          id: action.sendID,
          agentIDs: [...new Set(action.agentIDs)],
          correlated: false,
        });
      }
      break;
    case "pending.replace": {
      const pending = pendingSends.find((send) => send.id === action.sendID);
      const completed = completedTurns.find(
        (turn) => turn.turnID === action.replacementID && pending?.agentIDs.includes(turn.userID),
      );
      if (completed) {
        removePendingSend(pendingSends, action.sendID);
        break;
      }
      if (pending) {
        pending.id = action.replacementID;
        pending.correlated ||= turns.some(
          (turn) => turn.turnID === action.replacementID && pending.agentIDs.includes(turn.userID),
        );
      }
      break;
    }
    case "pending.fail":
      removePendingSend(pendingSends, action.sendID);
      break;
    case "progress.start": {
      if (hasCompletedTurn(completedTurns, action.turn.turnID, action.turn.userID)) break;
      if (!turns.some((turn) => turn.key === action.turn.key)) turns.push(action.turn);
      const pending = pendingSends.find((send) => send.id === action.turn.turnID);
      if (pending && pending.agentIDs.includes(action.turn.userID)) pending.correlated = true;
      break;
    }
    case "progress.stop": {
      const removedTurn = removeTurn(turns, action.turn);
      // Progress turn IDs are source-message IDs. Only consume the send when
      // that exact correlation exists; an unrelated bot turn must not clear it.
      const removedPending = removePendingSendForAgent(
        pendingSends,
        action.turn.turnID,
        action.turn.userID,
      );
      const expectedRace = pendingSends.some((send) => send.agentIDs.includes(action.turn.userID));
      if (removedTurn || removedPending || expectedRace) {
        rememberCompletedTurn(completedTurns, action.turn.turnID, action.turn.userID);
      }
      break;
    }
    case "response.final": {
      if (action.turnID) {
        const removedTurn = removeResponseTurn(turns, action.userID, action.turnID);
        const removedPending = removePendingSendForAgent(
          pendingSends,
          action.turnID,
          action.userID,
        );
        const expectedRace = pendingSends.some((send) => send.agentIDs.includes(action.userID));
        if (removedTurn || removedPending || expectedRace) {
          rememberCompletedTurn(completedTurns, action.turnID, action.userID);
        }
        break;
      }
      // Compatibility for bots on the pre-correlation message contract. Once a
      // send has emitted correlated progress, only its exact turn ID may clear
      // it. For legacy bots, clear only when this author has one unambiguous
      // pending send.
      const legacyCandidates = pendingSends.filter(
        (send) => !send.correlated && send.agentIDs.includes(action.userID),
      );
      if (legacyCandidates.length === 1) removePendingSend(pendingSends, legacyCandidates[0].id);
      break;
    }
  }

  return pendingSends.length > 0 || turns.length > 0 || completedTurns.length > 0
    ? { pendingSends, turns, completedTurns }
    : undefined;
}

function removePendingSend(pendingSends: PendingAgentSend[], sendID?: string): boolean {
  if (!sendID) return false;
  const index = pendingSends.findIndex((send) => send.id === sendID);
  if (index < 0) return false;
  pendingSends.splice(index, 1);
  return true;
}

function removePendingSendForAgent(
  pendingSends: PendingAgentSend[],
  sendID: string,
  userID: string,
): boolean {
  const index = pendingSends.findIndex(
    (send) => send.id === sendID && send.agentIDs.includes(userID),
  );
  if (index < 0) return false;
  pendingSends.splice(index, 1);
  return true;
}

function removeTurn(turns: AgentWorkingTurn[], target: AgentWorkingTurn): boolean {
  const index = turns.findIndex((turn) => turn.key === target.key);
  if (index < 0) return false;
  turns.splice(index, 1);
  return true;
}

function removeResponseTurn(
  turns: AgentWorkingTurn[],
  userID: string,
  turnID: string,
): AgentWorkingTurn | undefined {
  const index = turns.findIndex(
    (turn) => turn.turnID === turnID && (!userID || turn.userID === userID),
  );
  if (index < 0) return undefined;
  return turns.splice(index, 1)[0];
}

function hasCompletedTurn(
  completedTurns: CompletedAgentTurn[],
  turnID: string,
  userID: string,
): boolean {
  return completedTurns.some((turn) => turn.turnID === turnID && turn.userID === userID);
}

function rememberCompletedTurn(
  completedTurns: CompletedAgentTurn[],
  turnID: string,
  userID: string,
): void {
  if (!turnID || !userID || hasCompletedTurn(completedTurns, turnID, userID)) return;
  completedTurns.push({ turnID, userID });
  if (completedTurns.length > 32) completedTurns.splice(0, completedTurns.length - 32);
}
