import { useEffect } from 'react'
import type { JSX } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import { markdownToDoc } from '../lib/markdown'
import { useWyrm } from '../store'

/**
 * The writing terminal. Deliberately quiet: no spellcheck, no suggestions,
 * no toolbar. Formatting is bold / italic / highlight only (§3 of the brief).
 */
export function Editor(): JSX.Element {
  const activeId = useWyrm((s) => s.activeId)
  const activeDoc = useWyrm((s) => s.activeDoc)
  const wordCount = useWyrm((s) => s.wordCount)
  const setEditor = useWyrm((s) => s.setEditor)
  const editorChanged = useWyrm((s) => s.editorChanged)

  // Recreated per document (deps: [activeId]) so undo history never crosses
  // documents — ⌘Z in one scene must not resurrect another scene's text.
  const editor = useEditor(
    {
      content: activeDoc ? markdownToDoc(activeDoc.body) : undefined,
      autofocus: 'end',
      extensions: [
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
      ],
      editorProps: {
        attributes: {
          class: 'page',
          spellcheck: 'false',
          autocorrect: 'off',
          autocapitalize: 'off'
        }
      },
      onUpdate: () => editorChanged()
    },
    [activeId]
  )

  useEffect(() => {
    setEditor(editor ?? null)
    return () => setEditor(null)
  }, [editor, setEditor])

  return (
    <div className="terminal">
      <div className="terminal-top">
        <span>{activeDoc?.meta.title ?? ''}</span>
        <span>{wordCount.toLocaleString()} words</span>
      </div>
      <div className="terminal-scroll">
        <EditorContent editor={editor} className="editor-host" />
      </div>
    </div>
  )
}
