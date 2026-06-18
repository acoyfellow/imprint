import type { ModelProvider } from './types';

interface WorkersAiOptions {
  accountId: string;
  apiToken: string;
  model?: string;
}

export class WorkersAiProvider implements ModelProvider {
  readonly model: string;

  constructor(private readonly options: WorkersAiOptions) {
    this.model = options.model ?? '@cf/qwen/qwen2.5-coder-32b-instruct';
  }

  async generate(input: { system: string; prompt: string; maxTokens?: number }) {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.options.accountId}/ai/run/${this.model}`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.apiToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: input.system },
            { role: 'user', content: input.prompt },
          ],
          max_tokens: input.maxTokens ?? 800,
        }),
      },
    );
    const payload = (await response.json()) as {
      success?: boolean;
      result?: { response?: string; usage?: Record<string, number> };
      errors?: Array<{ message?: string }>;
    };
    if (!response.ok || !payload.success || !payload.result?.response) {
      throw new Error(
        payload.errors?.[0]?.message ?? `Workers AI returned HTTP ${response.status}`,
      );
    }
    return { text: payload.result.response, model: this.model, usage: payload.result.usage };
  }
}
