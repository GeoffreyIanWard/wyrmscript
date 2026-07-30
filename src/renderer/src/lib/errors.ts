/** Human-readable message for anything thrown across the IPC bridge. */
export function errorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  // Electron prefixes IPC rejections with the handler plumbing; keep the cause.
  return raw.replace(/^Error invoking remote method '[^']*':\s*/, '')
}
