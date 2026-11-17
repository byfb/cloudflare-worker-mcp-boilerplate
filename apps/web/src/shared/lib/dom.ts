export function element<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const node = root.querySelector<T>(selector)
  if (!node) throw new Error(`Missing page element: ${selector}`)
  return node
}

export function showError(node: HTMLElement, message: string | null) {
  node.textContent = message ?? ''
  node.hidden = !message
}

export function errorMessage(failure: unknown, fallback: string): string {
  return failure instanceof Error ? failure.message : fallback
}
