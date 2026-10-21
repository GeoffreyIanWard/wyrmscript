/**
 * Ids become filenames inside the project (`<dir>/<id>.md`, a portrait's
 * `<dir>/<id>.<ext>`), and they come from frontmatter — so a synced or
 * hand-edited file can carry any string at all. One with a separator or `..`
 * is refused outright rather than resolved to wherever it points, which would
 * let a later write or delete reach outside the project's folder. Every id
 * this app mints is base-36, so a real one never trips this.
 */
export function isPlainId(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    id !== '' &&
    !id.includes('/') &&
    !id.includes('\\') &&
    !id.includes('..')
  )
}

/** Throws on an id `isPlainId` refuses; `what` names it in the message. */
export function assertPlainId(id: string, what = 'entry'): void {
  if (!isPlainId(id)) throw new Error(`Not a valid ${what} id: ${JSON.stringify(id)}`)
}
