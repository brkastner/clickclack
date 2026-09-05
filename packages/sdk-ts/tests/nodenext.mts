// Exercise the built declarations as a Node ESM consumer, without skipLibCheck.
import type { Message, WorkflowSnapshot } from "../dist/index.js";

type IsAny<T> = 0 extends 1 & T ? true : false;
type AssertFalse<T extends false> = T;
export type MessageRemainsTyped = AssertFalse<IsAny<Message>>;
export type SnapshotRemainsTyped = AssertFalse<IsAny<WorkflowSnapshot>>;
export type SnapshotSourceRemainsTyped = AssertFalse<IsAny<WorkflowSnapshot["source"]>>;
