import type { ModelProvider } from './types';

interface WorkersAiOptions {
  accountId: string;
  apiToken: string;
  model?: string;
}

export class AiGatewayProvider implements ModelProvider {
  readonly model: string;
  readonly via = 'ai-gateway';

  constructor(
    private readonly options: {
      baseUrl: string;
      apiToken: string;
      model?: string;
      headers?: Record<string, string>;
    },
  ) {
    this.model = options.model ?? 'grok-4.6';
  }

  async generate(input: { system: string; prompt: string; maxTokens?: number }) {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.options.apiToken}`,
      'content-type': 'application/json',
      ...this.options.headers,
    };
    const response = await fetch(`${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.prompt },
        ],
        max_tokens: input.maxTokens ?? 800,
      }),
    });
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
      usage?: Record<string, number>;
      error?: { message?: string } | string;
    };
    const text = payload.choices?.[0]?.message?.content?.trim() ?? '';
    if (!response.ok || !text) {
      const message =
        typeof payload.error === 'string'
          ? payload.error
          : (payload.error?.message ?? `AI Gateway returned HTTP ${response.status}`);
      throw new Error(message);
    }
    return { text, model: payload.model ?? this.model, usage: payload.usage };
  }
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
