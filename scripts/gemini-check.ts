import { HttpException } from '@nestjs/common';
import { loadBackendEnv } from '../src/config/env';
import { resolveProvider, normalizeGeminiModelId } from '../src/ai/provider';
import { AiService } from '../src/ai/ai.service';
import { SpaceToolsService } from '../src/ai/space-tools.service';
import { SpaceConversationService } from '../src/ai/space-conversation.service';
import { SimulationService } from '../src/simulation/simulation.service';
import { toolNames } from '../src/ai/space-conversation.contract';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
async function main() {
  loadBackendEnv();
  if (process.argv.includes('--diagnostic')) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
      const response = await originalFetch(...args);
      const target =
        args[0] instanceof Request
          ? args[0].url
          : args[0] instanceof URL
            ? args[0].href
            : args[0];
      if (
        !response.ok &&
        target.startsWith('https://generativelanguage.googleapis.com/')
      ) {
        const error = (await response
          .clone()
          .json()
          .catch(() => null)) as {
          error?: { message?: string; status?: string };
        } | null;
        const key = process.env.AI_API_KEY ?? '';
        const message = JSON.stringify(error)
          .split(key || 'no-key')
          .join('[REDACTED]')
          .slice(0, 800);
        console.error(
          JSON.stringify({
            http: response.status,
            code: error?.error?.status,
            message,
          }),
        );
      }
      if (response.ok && target.endsWith('/chat/completions')) {
        const value = (await response.clone().json()) as {
          choices?: {
            finish_reason?: string;
            message?: { content?: string; tool_calls?: unknown[] };
          }[];
          usage?: unknown;
        };
        console.error(
          JSON.stringify({
            http: response.status,
            finish: value.choices?.[0]?.finish_reason,
            contentLength: value.choices?.[0]?.message?.content?.length,
            toolCalls: value.choices?.[0]?.message?.tool_calls?.length,
            usage: value.usage,
          }),
        );
      }
      return response;
    };
  }
  const runtime = resolveProvider();
  if (runtime.provider?.name !== 'gemini')
    throw new Error(
      'Configure the Google endpoint, a real AI_API_KEY and an explicit AI_MODEL first. No request sent.',
    );
  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/openai/models',
    {
      headers: { Authorization: `Bearer ${process.env.AI_API_KEY}` },
      signal: AbortSignal.timeout(25000),
    },
  );
  if (!response.ok)
    throw new Error(`Model list HTTP ${response.status}; details suppressed.`);
  const data = (await response.json()) as { data?: { id: string }[] };
  const names = (data.data ?? [])
    .map((m) =>
      typeof m.id === 'string' ? normalizeGeminiModelId(m.id) : m.id,
    )
    .filter((n) => typeof n === 'string' && /gemini.*flash/i.test(n));
  console.log(
    JSON.stringify({
      flashModels: names,
      selected: runtime.model,
      listed: names.includes(runtime.model),
    }),
  );
  if (!names.includes(runtime.model))
    throw new Error(
      'Configured Flash model not present in the accessible model list. No generation sent.',
    );
  if (!process.argv.includes('--smoke') && !process.argv.includes('--tools'))
    return;
  const directory = mkdtempSync(join(tmpdir(), 'helios-gemini-smoke-'));
  const old = process.env.SIMULATION_DATA_DIR;
  process.env.SIMULATION_DATA_DIR = directory;
  try {
    const sessions = new SimulationService();
    const sid = randomUUID();
    sessions.initialize(sid, { scenarioId: 'baseline' });
    sessions.action(sid, randomUUID(), 0, {
      type: 'setRole',
      role: 'astronaut',
      sessionCrewId: 'elena-torres',
    });
    const tools = new SpaceToolsService(sessions);
    const token = tools.issue(sid, {
      crewId: 'elena-torres',
      pin: '1001',
      modelConsent: true,
      historyConsent: true,
      dataUse: { sleep: true, pulse: true, symptoms: true, mission: true },
    }).token;
    const service = new SpaceConversationService(new AiService(runtime), tools);
    const checks = process.argv.includes('--tools')
      ? [...toolNames]
      : ['basic'];
    for (const name of checks) {
      const result = await service.respond(
        {
          crewId: 'elena-torres',
          textoPersona:
            name === 'basic'
              ? 'Hello, this is a synthetic demonstration. Respond briefly.'
              : `In this synthetic demo, consult ${name} before responding. Never modify any state.`,
          locale: 'en',
          selectedLevel: 'solo_yo',
          history: [],
        },
        sid,
        token,
        new AbortController().signal,
      );
      const used = result.toolsUsed
        .filter((t) => t.status === 'ok')
        .map((t) => t.name);
      if (name !== 'basic' && !used.includes(name))
        throw new Error(`Model did not request ${name}; check not verified.`);
      console.log(
        JSON.stringify({
          check: name,
          model: runtime.model,
          valid: true,
          toolsUsed: used,
          shareLevel: result.result.nivel,
        }),
      );
    }
    tools.revoke(sid, token);
  } finally {
    if (old === undefined) delete process.env.SIMULATION_DATA_DIR;
    else process.env.SIMULATION_DATA_DIR = old;
    rmSync(directory, { recursive: true, force: true });
  }
}
void main().catch((error: unknown) => {
  if (error instanceof HttpException) {
    const body = error.getResponse() as { code?: string };
    console.error(
      JSON.stringify({ status: error.getStatus(), code: body.code }),
    );
  }
  console.error(
    error instanceof Error &&
      !('cause' in error) &&
      !/fetch|http[s]?:/i.test(error.message)
      ? error.message
      : 'Gemini verification failed; sensitive details suppressed.',
  );
  process.exitCode = 1;
});
