interface Env {
  AI: Ai;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') return new Response('POST required', { status: 405 });
    const input = (await request.json()) as { repository: string; commit: string; context: string; question: string };
    const result = await env.AI.run('@cf/qwen/qwen2.5-coder-32b-instruct', {
      messages: [
        {
          role: 'system',
          content: `Answer only from repository ${input.repository} at commit ${input.commit}. Cite file paths.\n\n${input.context}`,
        },
        { role: 'user', content: input.question },
      ],
      max_tokens: 800,
    });
    return Response.json(result);
  },
};
