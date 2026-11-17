export const edgeNavigationDenylist = [
  /^\/api(?:\/|$)/,
  /^\/mcp/,
  /^\/\.well-known(?:\/|$)/,
  /^\/cdn-cgi(?:\/|$)/,
]
export function isEdgePath(path: string): boolean {
  return edgeNavigationDenylist.some((pattern) => pattern.test(path))
}
