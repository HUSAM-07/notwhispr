import type {
  AppSettings,
  AppStatus,
  ImageAgentDecision,
  ImageGenerationResult,
} from '../shared/types';
import { classifyWithOpenRouter, generateImage } from './openrouter';
import { classifyWithLiteLLM } from './litellm';
import { uploadImageToObjectStore } from './supabase-storage';

const IMAGE_TRIGGER_PATTERNS: RegExp[] = [
  /\b(create|generate|make|draw|render|design|sketch|produce|paint)\s+(?:me\s+)?(?:an?|the)?\s*(?:image|picture|photo|illustration|drawing|render|render|artwork|wallpaper|graphic|poster)\b/i,
  /\b(image|picture|photo|illustration|drawing|wallpaper|artwork|poster)\s+(?:of|about|showing|depicting|with)\b/i,
  /\bvisualize\b.*\b(this|that|it)\b/i,
  /\b(?:can|could|please)?\s*you\s+(?:create|make|generate|draw)\s+(?:me\s+)?(?:an?\s+)?(?:image|picture|illustration)\b/i,
];

export function detectImageTrigger(text: string): boolean {
  const lower = text.toLowerCase();
  return IMAGE_TRIGGER_PATTERNS.some((pattern) => pattern.test(lower));
}

interface AgentExtractionInput {
  settings: AppSettings;
  rawText: string;
  rewrittenText: string;
}

const SYSTEM_PROMPT = [
  'You are an intent router for a voice dictation app.',
  'Decide whether the user wants to GENERATE AN IMAGE alongside their text, or whether the text is purely written content.',
  'Output JSON ONLY in this schema (no prose, no markdown fences):',
  '{',
  '  "intent": "image" | "text",',
  '  "imagePrompt": string,   // a precise, visual, comma-separated description of what to render. Empty string when intent is "text".',
  '  "cleanedText": string    // the dictation with any image-request phrasing removed, suitable for pasting alongside the image. When intent is "text", return the dictation unchanged.',
  '}',
  '',
  'Rules:',
  '- Choose "image" whenever the speaker says any of: create / generate / make / draw / render / paint / sketch / design / produce / visualize / picture / illustrate, paired with image / picture / photo / illustration / drawing / artwork / wallpaper / poster.',
  '- IMPORTANT: When the speaker says "this", "that", "it", or any other pronoun in the image instruction, those pronouns refer to the OTHER content in the dictation. Use that surrounding content as the visual subject. Never write the literal word "this" as the imagePrompt.',
  '- If the speaker corrects themselves about the image content, use only their final intent.',
  '- imagePrompt must be a self-contained visual description (no meta phrases like "an image of"); think 1-2 dense sentences a diffusion model can use, with concrete visual details.',
  '- Never include explanations, never wrap output in code fences. JSON only.',
  '',
  'Examples:',
  '- Dictation: "Send the team a note about ship dates. Create an image about this." → {"intent":"image","imagePrompt":"a sleek calendar with rocket launch icon, project timeline, professional illustration","cleanedText":"Send the team a note about ship dates."}',
  '- Dictation: "I went to the store today." → {"intent":"text","imagePrompt":"","cleanedText":"I went to the store today."}',
].join('\n');

const FENCE_PATTERN = /^```(?:json)?\s*([\s\S]*?)\s*```$/;
const JSON_BLOCK_PATTERN = /\{[\s\S]*\}/;

function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(FENCE_PATTERN);
  return match ? match[1].trim() : trimmed;
}

function parseDecision(payload: string): ImageAgentDecision | null {
  const candidates: string[] = [];
  const stripped = stripCodeFences(payload);
  candidates.push(stripped);
  const blockMatch = stripped.match(JSON_BLOCK_PATTERN);
  if (blockMatch) candidates.push(blockMatch[0]);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Partial<ImageAgentDecision>;
      if (parsed.intent !== 'image' && parsed.intent !== 'text') continue;
      return {
        intent: parsed.intent,
        imagePrompt: typeof parsed.imagePrompt === 'string' ? parsed.imagePrompt : undefined,
        cleanedText: typeof parsed.cleanedText === 'string' ? parsed.cleanedText : undefined,
      };
    } catch {
      // try the next candidate
    }
  }
  return null;
}

const USER_PROMPT_BUILDER = (rawText: string, rewrittenText: string): string =>
  [
    '<rawDictation>',
    rawText,
    '</rawDictation>',
    '',
    '<rewrittenDictation>',
    rewrittenText,
    '</rewrittenDictation>',
    '',
    'Return the JSON now.',
  ].join('\n');

async function classifyViaOllama(
  ollamaBaseUrl: string,
  textModel: string,
  userPrompt: string,
): Promise<string> {
  const url = new URL('/api/chat', ollamaBaseUrl).toString();
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: textModel,
      stream: false,
      format: 'json',
      keep_alive: '10m',
      options: { temperature: 0 },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`Intent classifier returned ${response.status}.`);
  }
  const payload = (await response.json()) as { message?: { content?: string } };
  return payload.message?.content ?? '';
}

const VAGUE_PROMPT_PATTERN = /^(this|that|it|the above|same)\.?$/i;

export async function classifyDictationIntent({
  settings,
  rawText,
  rewrittenText,
}: AgentExtractionInput): Promise<ImageAgentDecision> {
  const triggerHit = detectImageTrigger(rawText) || detectImageTrigger(rewrittenText);
  console.log('[image-agent] regex trigger:', triggerHit, '| raw:', JSON.stringify(rawText));

  if (!triggerHit) {
    return { intent: 'text', cleanedText: rewrittenText };
  }

  const userPrompt = USER_PROMPT_BUILDER(rawText, rewrittenText);
  const provider = settings.textProvider;
  console.log('[image-agent] classifying via', provider, 'model:',
    provider === 'openrouter'
      ? settings.openrouterTextModel
      : provider === 'litellm'
        ? settings.litellmTextModel
        : settings.textModel);

  let raw: string;
  try {
    raw = provider === 'openrouter'
      ? await classifyWithOpenRouter(
          settings.openrouterApiKey,
          settings.openrouterTextModel,
          SYSTEM_PROMPT,
          userPrompt,
        )
      : provider === 'litellm'
        ? await classifyWithLiteLLM(
            settings.litellmBaseUrl,
            settings.litellmApiKey,
            settings.litellmTextModel,
            SYSTEM_PROMPT,
            userPrompt,
          )
      : await classifyViaOllama(settings.ollamaBaseUrl, settings.textModel, userPrompt);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Intent classifier failed.';
    console.warn('[image-agent] classifier call failed:', reason);
    return { intent: 'text', cleanedText: rewrittenText, reason };
  }

  console.log('[image-agent] classifier raw response:', raw.slice(0, 500));

  const decision = parseDecision(raw);
  if (!decision) {
    console.warn('[image-agent] could not parse JSON from classifier response');
    return {
      intent: 'text',
      cleanedText: rewrittenText,
      reason: 'Classifier returned malformed JSON; raw text was pasted instead.',
    };
  }

  console.log('[image-agent] parsed decision:', {
    intent: decision.intent,
    imagePrompt: decision.imagePrompt,
    cleanedText: decision.cleanedText?.slice(0, 80),
  });

  if (decision.intent !== 'image') {
    return decision;
  }

  const trimmedPrompt = decision.imagePrompt?.trim() ?? '';
  const isVague = !trimmedPrompt || VAGUE_PROMPT_PATTERN.test(trimmedPrompt) || trimmedPrompt.length < 5;

  if (isVague) {
    const fallbackPrompt = (decision.cleanedText?.trim() || rewrittenText.trim() || rawText.trim());
    if (!fallbackPrompt) {
      return {
        intent: 'text',
        cleanedText: rewrittenText,
        reason: 'Image was requested but no subject could be inferred.',
      };
    }
    console.log('[image-agent] vague prompt — falling back to surrounding dictation:', fallbackPrompt.slice(0, 120));
    return {
      intent: 'image',
      imagePrompt: fallbackPrompt,
      cleanedText: decision.cleanedText ?? rewrittenText,
      reason: `Inferred subject from dictation since classifier returned "${trimmedPrompt || '<empty>'}".`,
    };
  }

  return decision;
}

interface RunAgentInput {
  settings: AppSettings;
  rawText: string;
  rewrittenText: string;
  setStatus: (status: AppStatus) => void;
}

export async function runImageAgent({
  settings,
  rawText,
  rewrittenText,
  setStatus,
}: RunAgentInput): Promise<{
  finalText: string;
  image?: ImageGenerationResult;
  decisionReason?: string;
}> {
  console.log('[image-agent] runImageAgent called. enabled:', settings.imageAgent.enabled,
    '| apiKeySet:', Boolean(settings.openrouterApiKey),
    '| imageModel:', settings.imageAgent.imageModel);

  if (!settings.imageAgent.enabled) {
    console.log('[image-agent] skipping — toggle is OFF');
    return { finalText: rewrittenText, decisionReason: 'Image agent is disabled in Models › Image AI.' };
  }
  if (!settings.openrouterApiKey) {
    console.log('[image-agent] skipping — no OpenRouter API key');
    return { finalText: rewrittenText, decisionReason: 'Add an OpenRouter API key to enable image generation.' };
  }

  const decision = await classifyDictationIntent({
    settings,
    rawText,
    rewrittenText,
  });

  if (decision.intent !== 'image' || !decision.imagePrompt) {
    console.log('[image-agent] not generating image. intent:', decision.intent, '| reason:', decision.reason);
    return { finalText: decision.cleanedText ?? rewrittenText, decisionReason: decision.reason };
  }

  console.log('[image-agent] generating image. model:', settings.imageAgent.imageModel,
    '| prompt:', decision.imagePrompt.slice(0, 200));

  setStatus({
    phase: 'imaging',
    title: 'Generating image',
    detail: `${settings.imageAgent.imageModel} is rendering "${decision.imagePrompt.slice(0, 80)}".`,
    preview: decision.cleanedText ?? rewrittenText,
    rawText,
  });

  const generated = await generateImage(
    settings.openrouterApiKey,
    settings.imageAgent.imageModel,
    decision.imagePrompt,
  );
  console.log('[image-agent] image generated, uploading to object store. mime:', generated.mimeType,
    '| bytes(base64):', generated.base64.length);
  const url = await uploadImageToObjectStore(generated.base64, generated.mimeType, settings.imageStorage);
  console.log('[image-agent] uploaded. url:', url);

  const cleanedText = decision.cleanedText?.trim() || rewrittenText.trim();
  const finalText = cleanedText ? `${cleanedText}\n\n${url}` : url;

  return {
    finalText,
    image: {
      url,
      prompt: decision.imagePrompt,
      model: settings.imageAgent.imageModel,
    },
  };
}
