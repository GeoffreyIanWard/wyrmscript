declare module 'diff3' {
  /** One run of a three-way merge: lines all sides agree on, or a conflict. */
  interface Diff3Item {
    ok?: string[]
    conflict?: {
      a: string[]
      aIndex: number
      o: string[]
      oIndex: number
      b: string[]
      bIndex: number
    }
  }
  /** Merge `a` and `b`, both changed from `o`, line by line. */
  export default function diff3Merge(a: string[], o: string[], b: string[]): Diff3Item[]
}
