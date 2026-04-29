import type { OpenRouterModelInfo } from '../shared/types';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_TIMEOUT_MS = 90_000;
const OPENROUTER_REWRITE_TIMEOUT_MS = 30_000;
const OPENROUTER_MODELS_TIMEOUT_MS = 15_000;
const APP_REFERER = 'https://openwhisp.local';
const APP_TITLE = 'OpenWhisp';

export const CURATED_TEXT_MODELS: OpenRouterModelInfo[] = [
  {
    id: 'google/gemini-2.5-flash-lite',
    name: 'Gemini 2.5 Flash Lite',
    description: 'Cheap and fast — recommended default. ~$0.10/M in, $0.40/M out.',
    promptPrice: '0.10',
    contextLength: 1_048_576,
  },
  {
    id: 'google/gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite',
    description: 'Newest Google small model. 2.5× faster TTFT than 2.5 Flash.',
    promptPrice: '0.25',
    contextLength: 1_048_576,
  },
  {
    id: 'openai/gpt-5.4-nano',
    name: 'GPT-5.4 Nano',
    description: 'Better at dense instructions and JSON-mode reliability.',
    promptPrice: '0.20',
    contextLength: 400_000,
  },
  {
    id: 'deepseek/deepseek-v3.2',
    name: 'DeepSeek V3.2',
    description: 'Budget pick — ~90% of frontier quality at a tiny fraction of the cost.',
    promptPrice: '0.01',
    contextLength: 128_000,
  },
];

interface RawOpenRouterModel {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
    image?: string;
  };
  architecture?: {
    output_modalities?: string[];
    modality?: string;
  };
  output_modalities?: string[];
}

interface OpenRouterModelsResponse {
  data?: RawOpenRouterModel[];
}

interface OpenRouterImageMessage {
  role: 'assistant';
  content?: string;
  images?: Array<{
    type?: string;
    image_url?: {
      url?: string;
    };
  }>;
}

interface OpenRouterChatResponse {
  choices?: Array<{
    message?: OpenRouterImageMessage;
  }>;
  error?: {
    message?: string;
    code?: number;
  };
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

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'HTTP-Referer': APP_REFERER,
    'X-Title': APP_TITLE,
  };
}

function supportsImageOutput(model: RawOpenRouterModel): boolean {
  const output =
    model.architecture?.output_modalities ??
    model.output_modalities ??
    [];
  return output.includes('image');
}

export async function listImageModels(apiKey: string): Promise<OpenRouterModelInfo[]> {
  if (!apiKey) {
    throw new Error('Add your OpenRouter API key first.');
  }

  const response = await fetchWithTimeout(
    `${OPENROUTER_BASE_URL}/models`,
    {
      method: 'GET',
      headers: authHeaders(apiKey),
    },
    OPENROUTER_MODELS_TIMEOUT_MS,
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      response.status === 401
        ? 'OpenRouter rejected the API key. Double-check it on openrouter.ai.'
        : `OpenRouter returned ${response.status}: ${text || response.statusText}`,
    );
  }

  const payload = (await response.json()) as OpenRouterModelsResponse;
  const models = (payload.data ?? []).filter(supportsImageOutput);

  return models
    .map<OpenRouterModelInfo>((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      description: model.description,
      promptPrice: model.pricing?.prompt,
      imagePrice: model.pricing?.image,
      contextLength: model.context_length,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function verifyApiKey(apiKey: string): Promise<boolean> {
  try {
    await listImageModels(apiKey);
    return true;
  } catch {
    return false;
  }
}

export function listCuratedTextModels(): OpenRouterModelInfo[] {
  return CURATED_TEXT_MODELS;
}

export interface GeneratedImage {
  base64: string;
  mimeType: string;
}

function parseDataUrl(dataUrl: string): GeneratedImage | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}

export async function generateImage(
  apiKey: string,
  modelId: string,
  prompt: string,
): Promise<GeneratedImage> {
  if (!apiKey) {
    throw new Error('Add your OpenRouter API key in Models › Image AI.');
  }

  const response = await fetchWithTimeout(
    `${OPENROUTER_BASE_URL}/chat/completions`,
    {
      method: 'POST',
      headers: {
        ...authHeaders(apiKey),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: prompt }],
        modalities: ['image', 'text'],
      }),
    },
    OPENROUTER_TIMEOUT_MS,
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `OpenRouter image request failed (${response.status}): ${text || response.statusText}`,
    );
  }

  const payload = (await response.json()) as OpenRouterChatResponse;
  if (payload.error) {
    throw new Error(payload.error.message ?? 'OpenRouter returned an error.');
  }

  const message = payload.choices?.[0]?.message;
  const dataUrl = message?.images?.[0]?.image_url?.url;
  if (!dataUrl) {
    throw new Error(
      `${modelId} did not return an image. Try a different image-output model.`,
    );
  }

  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    throw new Error('OpenRouter returned an image in an unexpected format.');
  }
  return parsed;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenRouterTextResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

async function chatCompletion(
  apiKey: string,
  modelId: string,
  messages: ChatMessage[],
  options: { jsonMode?: boolean } = {},
): Promise<string> {
  if (!apiKey) {
    throw new Error('Add your OpenRouter API key in Models › Text Enhancement.');
  }

  const body: Record<string, unknown> = {
    model: modelId,
    messages,
    temperature: 0,
  };
  if (options.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const response = await fetchWithTimeout(
    `${OPENROUTER_BASE_URL}/chat/completions`,
    {
      method: 'POST',
      headers: {
        ...authHeaders(apiKey),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    OPENROUTER_REWRITE_TIMEOUT_MS,
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      response.status === 401
        ? 'OpenRouter rejected the API key. Update it in Models.'
        : `OpenRouter chat request failed (${response.status}): ${text || response.statusText}`,
    );
  }

  const payload = (await response.json()) as OpenRouterTextResponse;
  if (payload.error) {
    throw new Error(payload.error.message ?? 'OpenRouter returned an error.');
  }
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenRouter returned an empty response.');
  }
  return content;
}

export async function rewriteWithOpenRouter(
  apiKey: string,
  modelId: string,
  systemPrompt: string,
  rawText: string,
): Promise<string> {
  return chatCompletion(apiKey, modelId, [
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

export async function commandWithOpenRouter(
  apiKey: string,
  modelId: string,
  systemPrompt: string,
  rawText: string,
): Promise<string> {
  return chatCompletion(apiKey, modelId, [
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

export async function classifyWithOpenRouter(
  apiKey: string,
  modelId: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  return chatCompletion(
    apiKey,
    modelId,
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    { jsonMode: true },
  );
}
