import { handleMcpRequest } from '../apps/worker/mcp/server'

/** Local protocol fixture: synthetic data, no database and no production imports of this entrypoint. */
export default {
  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname !== '/mcp') return new Response('Not Found', { status: 404 })
    return handleMcpRequest(request, {
      principal: { userId: 'demo-account' },
      capabilities: { account: { async getBasicProfile() { return { username: 'demo' } } } },
      authorizeConnection: async () => {},
      transport: {
        publicOrigin: 'http://127.0.0.1:8788',
        allowedHostnames: ['127.0.0.1'], allowedOriginHostnames: ['127.0.0.1'],
      },
    })
  },
}
