/** SDK session settings shared by every research turn and covered by local regression tests. */
export function researchSessionOptions(sessionId?: string): {
  persistSession: true;
  resume?: string;
} {
  return sessionId ? { persistSession: true, resume: sessionId } : { persistSession: true };
}
