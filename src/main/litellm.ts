interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LiteLLMTextResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

const LITELLM_TIMEOUT_MS = 90_000;
const LITELLM_REWRITE_TIMEOUT_MS = 30_000;

function buildUrl(baseUrl: string, pathName: string): string {
  return new URL(pathName.replace(/^\//, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function requireLiteLLMSettings(baseUrl: string, apiKey: string, modelId: string): void {
  if (!baseUrl.trim()) {
    throw new Error('Add your LiteLLM API base URL in Models.');
  }
  if (!apiKey.trim()) {
    throw new Error('Add your LiteLLM API key in Models.');
  }
  if (!modelId.trim()) {
    throw new Error('Add your LiteLLM model name in Models.');
  }
}

async function chatCompletion(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  messages: ChatMessage[],
  options: { jsonMode?: boolean } = {},
): Promise<string> {
  requireLiteLLMSettings(baseUrl, apiKey, modelId);

  const body: Record<string, unknown> = {
    model: modelId,
    messages,
    temperature: 0,
  };
  if (options.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(
      buildUrl(baseUrl, '/chat/completions'),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
      options.jsonMode ? LITELLM_TIMEOUT_MS : LITELLM_REWRITE_TIMEOUT_MS,
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('LiteLLM did not respond before the request timed out.');
    }
    throw error instanceof Error ? error : new Error('OpenWhisp could not reach LiteLLM.');
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      response.status === 401
        ? 'LiteLLM rejected the API key. Update it in Models.'
        : `LiteLLM chat request failed (${response.status}): ${text || response.statusText}`,
    );
  }

  const payload = (await response.json()) as LiteLLMTextResponse;
  if (payload.error) {
    throw new Error(payload.error.message ?? 'LiteLLM returned an error.');
  }

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('LiteLLM returned an empty response.');
  }
  return content;
}

export async function rewriteWithLiteLLM(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  systemPrompt: string,
  rawText: string,
): Promise<string> {
  return chatCompletion(baseUrl, apiKey, modelId, [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        'Rewrite the dictated text below.',
        'If the speaker corrected themselves or changed their mind, use only their final intent.',
        'Reply with only the final rewritten text — no preface, explanation, labels, or quotation marks.',
        '',
        '<dictation>',
        rawText,
        '</dictation>',
      ].join('\n'),
    },
  ]);
}

export async function commandWithLiteLLM(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  systemPrompt: string,
  rawText: string,
): Promise<string> {
  return chatCompletion(baseUrl, apiKey, modelId, [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        'Convert the dictated terminal intent below into exactly one shell command.',
        'Use only the final intent if the speaker corrected themselves.',
        'Reply with only the command. Do not add explanation, markdown, labels, quotes, or prompt markers.',
        '',
        '<dictation>',
        rawText,
        '</dictation>',
      ].join('\n'),
    },
  ]);
}

export async function classifyWithLiteLLM(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  return chatCompletion(
    baseUrl,
    apiKey,
    modelId,
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    { jsonMode: true },
  );
}
