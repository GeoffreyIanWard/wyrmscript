/**
 * jsdom has no layout engine, so a handful of DOM methods the app legitimately
 * calls simply do not exist there. Stubbing them here — once, in one place —
 * keeps that gap out of the components: none of this is app behaviour, and
 * none of it should be worked around with defensive `?.` in production code.
 *
 * Only applies to the jsdom tests; the node-environment ones never load this.
 */

if (typeof window !== 'undefined') {
  const define = (target: object, name: string, value: unknown): void => {
    Object.defineProperty(target, name, { value, configurable: true, writable: true })
  }

  // Keeping a selected row visible (binder cursor, palette results).
  define(Element.prototype, 'scrollIntoView', () => {})

  // ProseMirror asks nodes for their rects when it scrolls the selection into
  // view; jsdom answers on Element but not on Text.
  const emptyRect = (): DOMRect =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      toJSON: () => ({})
    }) as DOMRect

  for (const proto of [Element.prototype, Text.prototype, Range.prototype]) {
    define(proto, 'getClientRects', () => Object.assign([], { item: () => null }))
    define(proto, 'getBoundingClientRect', emptyRect)
  }

  // F-23's block cursor and F-27's gutter/page-view rules re-measure via
  // ResizeObserver on layout change; jsdom does not implement it at all.
  if (typeof window.ResizeObserver === 'undefined') {
    define(window, 'ResizeObserver', function (this: ResizeObserver) {
      this.observe = () => {}
      this.unobserve = () => {}
      this.disconnect = () => {}
    } as unknown as typeof ResizeObserver)
  }
}
