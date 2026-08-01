/**
 * The one definition of "a word" in the app.
 *
 * This lives in `shared/` rather than the renderer because two processes have
 * to agree on it: the status bar counts the open document in the renderer,
 * while the writing-stats engine counts historical manuscripts in the main
 * process. Two copies of this function would drift, and the drift would show
 * up as the status bar and the stats screen quoting different numbers for the
 * same text — so there is exactly one.
 *
 * Counting the stored Markdown gives the same answer as counting the editor's
 * plain text: the inline markers (`**bold**`, `==highlight==`) are always
 * attached to the words they wrap rather than standing as separate tokens, so
 * whitespace splitting lands on the same count either way.
 */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}
