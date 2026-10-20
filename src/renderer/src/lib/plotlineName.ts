/**
 * Why a new plotline cannot be added under this name, or null if it can.
 * Said to the writer, never enforced in silence: an Add button that quietly
 * did nothing on an empty field is the bug this replaces. A name another
 * plotline already has is refused too, because scenes join a plotline by
 * carrying its name as a tag, so two plotlines with one name would share
 * every scene. Compared case-insensitively, the way that match is read.
 */
export function plotlineNameProblem(wanted: string, taken: string[]): string | null {
  const name = wanted.trim()
  if (name === '') return 'Give the plotline a name first.'
  const clash = taken.find((t) => t.trim().toLowerCase() === name.toLowerCase())
  if (clash != null)
    return `There is already a plotline called “${clash.trim()}” — scenes join a plotline by its name, so each needs its own.`
  return null
}
