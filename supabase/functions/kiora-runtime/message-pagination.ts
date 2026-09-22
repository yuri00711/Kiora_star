import type { JsonObject } from "./types.ts";

export const INITIAL_MESSAGE_LIMIT = 40;
export const MAX_MESSAGE_PAGE_LIMIT = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MessageCursor = { created_at: string; id: string };

export function messagePageLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return INITIAL_MESSAGE_LIMIT;
  return Math.min(MAX_MESSAGE_PAGE_LIMIT, Math.max(1, Math.floor(parsed)));
}

export function messageCursor(createdAt: unknown, id: unknown): MessageCursor {
  const date = new Date(String(createdAt ?? ""));
  const messageId = String(id ?? "");
  if (Number.isNaN(date.getTime()) || !UUID.test(messageId)) {
    throw new Error("INVALID_MESSAGE_CURSOR");
  }
  return { created_at: date.toISOString(), id: messageId };
}

export function cursorForMessage(message: JsonObject | undefined): MessageCursor | null {
  if (!message) return null;
  return messageCursor(message.created_at, message.id);
}

export function olderMessagesFilter(cursor: MessageCursor): string {
  return `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`;
}

export function newerMessagesFilter(cursor: MessageCursor): string {
  return `created_at.gt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.gt.${cursor.id})`;
}

export function newestMessagePage(rows: JsonObject[], limit = INITIAL_MESSAGE_LIMIT): JsonObject {
  const page = rows.slice(0, limit);
  const messages = [...page].reverse();
  return {
    messages,
    has_older_messages: rows.length > limit,
    oldest_message_cursor: cursorForMessage(messages[0]),
    latest_message_cursor: cursorForMessage(messages[messages.length - 1]),
  };
}

export function olderMessagePage(rows: JsonObject[], limit: number): JsonObject {
  return newestMessagePage(rows, limit);
}

export function newerMessagePage(rows: JsonObject[], limit: number): JsonObject {
  const messages = rows.slice(0, limit);
  return {
    messages,
    has_newer_messages: rows.length > limit,
    oldest_message_cursor: cursorForMessage(messages[0]),
    latest_message_cursor: cursorForMessage(messages[messages.length - 1]),
  };
}
