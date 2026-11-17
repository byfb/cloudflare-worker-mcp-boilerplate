import { describe, expect, it } from 'vitest'
import {
  MCP_CLIENT_NAME_MAX_BYTES,
  MCP_CLIENT_VERSION_MAX_BYTES,
  normalizeMcpClientDescriptor,
} from './mcp-connection'

describe('MCP client-family identity', () => {
  it('normalizes a stable family key without using the changing version', () => {
    const first = normalizeMcpClientDescriptor({
      name: '  ChatGPT  ',
      title: 'ChatGPT Web',
      version: '1.0.0',
    })
    const upgraded = normalizeMcpClientDescriptor({
      name: 'chatgpt',
      title: 'ChatGPT',
      version: '2.0.0',
    })

    expect(first).toEqual({
      clientKey: 'chatgpt',
      displayName: 'ChatGPT Web',
      clientVersion: '1.0.0',
    })
    expect(upgraded.clientKey).toBe(first.clientKey)
    expect(upgraded.clientVersion).toBe('2.0.0')
  })

  it.each([
    [{ name: '', version: '1' }],
    [{ name: 'client\u0000name', version: '1' }],
    [{ name: 'x'.repeat(MCP_CLIENT_NAME_MAX_BYTES + 1), version: '1' }],
    [{ name: 'client', version: '' }],
    [{ name: 'client', version: 'x'.repeat(MCP_CLIENT_VERSION_MAX_BYTES + 1) }],
  ])('rejects missing, unsafe, or oversized identity %#', (input) => {
    expect(() => normalizeMcpClientDescriptor(input)).toThrowError(
      expect.objectContaining({
        code: 'mcp_client_identity_required',
        message: 'valid MCP client identity is required',
      }),
    )
  })

  it('falls back to the bounded implementation name for unusable display titles', () => {
    expect(normalizeMcpClientDescriptor({
      name: 'Gemini-Spark',
      title: '   ',
      version: '2026.8',
    })).toEqual({
      clientKey: 'gemini-spark',
      displayName: 'Gemini-Spark',
      clientVersion: '2026.8',
    })
  })
})
