#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const root = process.env.BUGCAPTURE_REPORTS ?? '.';
type Report = { id?: string; console?: unknown[]; network?: unknown[]; [key: string]: unknown };

async function reports(): Promise<Report[]> {
  const names = (await readdir(root)).filter((name) => name.endsWith('.json'));
  return Promise.all(
    names.map(async (name) => JSON.parse(await readFile(join(root, name), 'utf8'))),
  );
}
async function main(): Promise<void> {
  const input = createInterface({ input: process.stdin });
  for await (const line of input) {
    if (!line.trim()) continue;
    type Request = {
      id?: string | number;
      method?: string;
      params?: { name?: string; arguments?: { id?: string } };
    };
    let request: Request;
    try {
      request = JSON.parse(line) as Request;
    } catch {
      // A malformed line must not take the server down.
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`,
      );
      continue;
    }
    let result: unknown;
    if (request.method === 'initialize')
      result = {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'bugcapture-mcp', version: '0.1.0' },
      };
    else if (request.method === 'tools/list')
      result = {
        tools: [
          {
            name: 'list_reports',
            description: 'List exported BugCapture reports',
            inputSchema: { type: 'object', properties: {} },
          },
          {
            name: 'get_report',
            description: 'Read one exported report',
            inputSchema: {
              type: 'object',
              properties: { id: { type: 'string' } },
              required: ['id'],
            },
          },
          {
            name: 'get_console_logs',
            description: 'Read console entries for a report',
            inputSchema: {
              type: 'object',
              properties: { id: { type: 'string' } },
              required: ['id'],
            },
          },
          {
            name: 'get_network_logs',
            description: 'Read network entries for a report',
            inputSchema: {
              type: 'object',
              properties: { id: { type: 'string' } },
              required: ['id'],
            },
          },
        ],
      };
    else if (request.method === 'tools/call') {
      const all = await reports();
      const name = request.params?.name;
      const report = all.find((item) => item.id === request.params?.arguments?.id);
      const value =
        name === 'list_reports'
          ? all.map(({ id, title, createdAt, url }) => ({ id, title, createdAt, url }))
          : name === 'get_report'
            ? report
            : name === 'get_console_logs'
              ? (report?.console ?? [])
              : name === 'get_network_logs'
                ? (report?.network ?? [])
                : [];
      result = { content: [{ type: 'text', text: JSON.stringify(value ?? null) }] };
    } else {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } })}\n`,
      );
      continue;
    }
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);
  }
}
void main();
