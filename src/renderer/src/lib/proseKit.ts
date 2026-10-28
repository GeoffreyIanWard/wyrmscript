import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'

/**
 * What prose is made of, for every editor that writes it: paragraphs, hard
 * breaks, bold, italic and highlight — exactly what `lib/markdown.ts` can
 * store. Anything StarterKit would add beyond that (lists, headings, code)
 * would paste in, show on screen and then vanish on the next save, so it is
 * turned off. The page's editor and the scratch pad's share this list, so
 * text moves between them unchanged.
 */
export function proseExtensions(): [ReturnType<typeof StarterKit.configure>, typeof Highlight] {
  return [
    StarterKit.configure({
      blockquote: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      listKeymap: false,
      heading: false,
      codeBlock: false,
      code: false,
      horizontalRule: false,
      strike: false,
      underline: false,
      link: false
    }),
    Highlight
  ]
}
