// Shared wrapper for the four tool endpoints: checks the secret, runs the tool,
// logs the call, and turns any crash into a safe "pass it to reception" answer.

import { getSql } from './db';
import type { ToolResult } from './tools';
import type postgres from 'postgres';

type Run = (sql: postgres.Sql, input: Record<string, unknown>, conversationId: string | null) => Promise<ToolResult>;

const SYSTEM_ERROR: ToolResult = {
  ok: false,
  reason: 'system_error',
  instruction:
    'The agenda cannot be checked right now. Do not confirm any appointment. Collect name, phone, reason for the visit and preferred days or times, call note_for_reception, and tell the caller that reception will call back on the next working day.',
};

export function toolRoute(tool: string, run: Run) {
  return async function POST(request: Request): Promise<Response> {
    const secret = process.env.TOOL_SECRET;
    if (!secret || request.headers.get('x-tool-secret') !== secret) {
      return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
    }

    const started = Date.now();
    let input: Record<string, unknown> = {};
    let conversationId: string | null = null;
    let output: ToolResult;

    try {
      input = (await request.json()) as Record<string, unknown>;
      conversationId = typeof input.conversation_id === 'string' && input.conversation_id ? input.conversation_id : null;
      output = await run(getSql(), input, conversationId);
    } catch (error) {
      console.error(`[${tool}]`, error);
      output = SYSTEM_ERROR;
    }

    try {
      const sql = getSql();
      await sql`
        INSERT INTO tool_events (conversation_id, tool, input, output, ms)
        VALUES (${conversationId}, ${tool}, ${sql.json(input as never)}, ${sql.json(output as never)}, ${Date.now() - started})`;
    } catch (error) {
      console.error(`[${tool}] could not log event`, error);
    }

    // Always 200: the agent reads `ok` and `instruction`, not HTTP status codes.
    return Response.json(output);
  };
}
