/**
 * Fire-and-forget nudge for POST /api/dispatch/flush (057). Safe in client
 * components: no server imports. Failures are ignored — the outbox persists
 * and the next nudge retries.
 */
export function requestDispatchFlush(): void {
  void fetch("/api/dispatch/flush", { method: "POST" }).catch(() => undefined);
}
