/**
 * F-50 step 4: a first guess at whether a backup's drive is removable — a
 * card or a stick rather than the disk the computer runs from. Only a guess:
 * the writer says, with the Removable switch on the drive's card, and the
 * answer they give is stored and never guessed over again.
 *
 * Read from the path alone, so it works the same in either process and for
 * a drive that is not plugged in right now:
 * - macOS mounts every disk but the startup disk under `/Volumes/`;
 * - on Windows, any drive letter but the system drive (C:, unless told
 *   otherwise);
 * - on Linux, the usual mount points for media.
 * Anything else — a folder in the home directory, a network path — is taken
 * as fixed.
 */
export function guessRemovable(path: string, systemDrive = 'C:'): boolean {
  const letter = /^([A-Za-z]):[\\/]/.exec(path)
  if (letter) return `${letter[1].toUpperCase()}:` !== systemDrive.toUpperCase()
  return /^\/(Volumes|media|mnt|run\/media)\//.test(path)
}
