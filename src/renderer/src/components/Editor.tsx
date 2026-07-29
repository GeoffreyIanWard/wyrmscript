import { useEffect } from 'react'
import type { JSX } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import { useWyrm } from '../store'

/**
 * The writing terminal. Deliberately quiet: no spellcheck, no suggestions,
 * no toolbar. Formatting is bold / italic / highlight only (§3 of the brief).
 */
export function Editor(): JSX.Element {
  const activeDoc = useWyrm((s) => s.activeDoc)
  const wordCount = useWyrm((s) => s.wordCount)
  const setEditor = useWyrm((s) => s.setEditor)
  const editorChanged = useWyrm((s) => s.editorChanged)

  const editor = useEditor({
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
  })

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
