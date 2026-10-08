import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, sep, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RunStore } from '../src/server/store.js';
import { RunService } from '../src/server/service.js';

describe('MCP stdio adapter', () => {
  const directory = mkdtempSync(join(tmpdir(), 'consensus-trace-mcp-test-'));
  const client = new Client({ name: 'consensus-trace-test', version: '1.0.0' });
  let reportId = '';
  beforeAll(async () => {
    const store = new RunStore(join(directory, 'runs.sqlite')); reportId = (await new RunService(store).inspect(null, { fixtureId: 'successful' })).id; store.close();
    const env = Object.fromEntries(Object.entries(process.env).filter((pair): pair is [string, string] => typeof pair[1] === 'string'));
    await client.connect(new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', resolve('src/mcp/index.ts')], env: { ...env, TRACE_DATA_DIR: directory }, stderr: 'pipe' }));
  }, 30000);
  afterAll(async () => {
    await client.close();
    const path = resolve(directory); if (!path.startsWith(`${resolve(tmpdir())}${sep}consensus-trace-mcp-test-`)) throw new Error('Unsafe test cleanup path.');
    rmSync(path, { recursive: true, force: true });
  });
  it('exposes inspection, evidence and human-approved test handoffs without a signing tool', async () => { const tools = await client.listTools(); expect(tools.tools.map(tool => tool.name).sort()).toEqual(['evidence_manifest', 'get_report', 'inspect_transaction', 'list_reports', 'prepare_test', 'resolve_submission']); expect(tools.tools.find(tool => tool.name === 'inspect_transaction')?.description).toContain('Never signs'); expect(tools.tools.find(tool => tool.name === 'prepare_test')?.description).toContain('wallet approval'); });
  it('reads a report through the protocol', async () => { const response = await client.callTool({ name: 'get_report', arguments: { id: reportId } }); const content = response.content as { text: string }[]; expect(JSON.parse(content[0].text).report.origin).toBe('fixture'); });
  it('exports manifest metadata without publishing or executing anything', async () => { const response = await client.callTool({ name: 'evidence_manifest', arguments: { id: reportId } }); const content = response.content as { text: string }[]; const data = JSON.parse(content[0].text); expect(data.manifest.origin).toBe('fixture'); expect(data.zipSha256).toMatch(/^[a-f0-9]{64}$/); });
});
