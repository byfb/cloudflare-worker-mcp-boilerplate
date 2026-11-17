import { describe, expect, it, vi } from 'vitest'
import { executeExecCommand } from './exec-command'
import { MCP_MAX_REQUEST_BYTES } from './contracts'
import { prepareBoundedMcpRequest } from './request-body'
import { successfulToolResult } from './tool-result'

describe('generic MCP surface', () => {
  it('supports catalog discovery and dispatch with strict identity-free input', async () => {
    const dispatch = vi.fn(async () => ({ username: 'member' }))
    const signal = new AbortController().signal
    expect(await executeExecCommand('tools', dispatch, signal)).toEqual({ tools: ['get_user_profile'] })
    expect(await executeExecCommand('search profile', dispatch, signal)).toEqual({ matches: ['get_user_profile'] })
    expect(await executeExecCommand('info get_user_profile', dispatch, signal)).toMatchObject({ input_schema: { additionalProperties: false } })
    expect(await executeExecCommand('schema get_user_profile', dispatch, signal)).toMatchObject({ schema: { type: 'object' } })
    await expect(executeExecCommand('call get_user_profile {"user_id":"another"}', dispatch, signal)).rejects.toMatchObject({ code: 'invalid_tool_input' })
    await expect(executeExecCommand('call unknown {}', dispatch, signal)).rejects.toMatchObject({ code: 'unknown_operation' })
    await expect(executeExecCommand('echo hello', dispatch, signal)).rejects.toMatchObject({ code: 'unknown_command' })
    expect(dispatch).not.toHaveBeenCalled()
    expect(await executeExecCommand('call get_user_profile {}', dispatch, signal)).toEqual({ username: 'member' })
    expect(dispatch).toHaveBeenCalledExactlyOnceWith('get_user_profile', {}, signal)
  })

  it('bounds incoming JSON and strips private result fields', async () => {
    const request = new Request('https://app.example.com/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(MCP_MAX_REQUEST_BYTES + 1) })
    await expect(prepareBoundedMcpRequest(request)).rejects.toMatchObject({ status: 413 })
    await expect(prepareBoundedMcpRequest(new Request('https://app.example.com/mcp', { method: 'POST', body: '{}' }))).rejects.toMatchObject({ status: 415 })
    const result = successfulToolResult({ username: 'member', user_id: 'private', nested: { issuer: 'private', value: 1 } })
    expect(result.structuredContent).toEqual({ username: 'member', nested: { value: 1 } })
  })
})
