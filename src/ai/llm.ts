// One structured Claude call. Every AI feature in paydrill goes through here.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type * as z from 'zod/v4';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { CodeFile } from '../contract.ts';

export const MODEL = process.env.PAYDRILL_MODEL ?? 'claude-opus-5-5';

let client: Anthropic | undefined;

export type Effort = 'low' | 'medium' | 'high' | 'xhigh';

/** Ask Claude for JSON matching `schema`. Throws on refusal or unparseable output. */
export async function structured<T extends z.ZodType>(
  schema: T,
  system: string,
  user: string,
  effort: Effort = 'high',
): Promise<z.infer<T>> {
  client ??= new Anthropic();
  const msg = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 32000,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { effort, format: betaZodOutputFormat(schema) },
    // Server-side fallback if the model declines; routed by refusal category.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  });
  if (msg.stop_reason === 'refusal') throw new Error(`Claude declined: ${msg.stop_details?.explanation ?? 'no reason given'}`);
  if (msg.stop_reason === 'max_tokens') throw new Error('Claude ran out of output tokens; try fewer files');
  if (msg.parsed_output == null) throw new Error('Claude returned output that did not match the schema');
  return msg.parsed_output as z.infer<T>;
}

/** Files rendered with line numbers so Claude can cite "file:line" accurately. */
export function renderFiles(files: CodeFile[]): string {
  return files
    .map((f) => {
      const lines = f.text.split('\n').map((l, i) => `${String(i + 1).padStart(4)}| ${l}`).join('\n');
      return `<file path="${f.path}">\n${lines}\n</file>`;
    })
    .join('\n\n');
}

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.paydrill']);
const CODE = /\.(m?[jt]sx?|py)$/;

/** Read the source files of a project, relative paths, skipping build output. */
export function readCodeFiles(dir: string, maxBytes = 400_000): CodeFile[] {
  const out: CodeFile[] = [];
  let total = 0;
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (SKIP.has(name)) continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (CODE.test(name) && !name.endsWith('.d.ts')) {
        const text = readFileSync(p, 'utf8');
        total += text.length;
        // ponytail: hard cap instead of chunking; chunk by route if real apps exceed it
        if (total > maxBytes) throw new Error(`Project source is over ${maxBytes} bytes; point paydrill at the webhook folder`);
        out.push({ path: relative(dir, p), text });
      }
    }
  };
  walk(dir);
  return out;
}
