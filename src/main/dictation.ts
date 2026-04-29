import { clipboard } from 'electron';

import type {
  AppSettings,
  AppStatus,
  FocusInfo,
  ImageGenerationResult,
  ProcessAudioResult,
} from '../shared/types';
import { getEnhancementPrompt, getTerminalCommandPrompt } from './prompts';
import { commandWithOllama, rewriteWithOllama } from './ollama';
import { commandWithOpenRouter, rewriteWithOpenRouter } from './openrouter';
import { getFocusInfo, triggerPaste } from './native-helper';
import { detectImageTrigger, runImageAgent } from './image-agent';
import { generateDiagramDraft } from './diagram-agent';
import { ensureStorage } from './storage';

interface ProcessDictationOptions {
  wavBase64: string;
  settings: AppSettings;
  targetFocus?: FocusInfo;
  forceTerminalCommandMode?: boolean;
  disableTerminalCommandMode?: boolean;
  forceDiagramMode?: boolean;
  setStatus: (status: AppStatus) => void;
}

function createIdleStatus(): AppStatus {
  return {
    phase: 'idle',
    title: 'Ready',
    detail: 'Hold Option to dictate. Release Option to paste.',
  };
}

const TERMINAL_APP_NAMES = new Set([
  'terminal',
  'iterm',
  'iterm2',
  'warp',
  'wezterm',
  'alacritty',
  'kitty',
  'ghostty',
  'hyper',
  'tabby',
]);

const TERMINAL_BUNDLE_FRAGMENTS = [
  'com.apple.terminal',
  'com.googlecode.iterm2',
  'dev.warp',
  'com.github.wez.wezterm',
  'org.alacritty',
  'net.kovidgoyal.kitty',
  'com.mitchellh.ghostty',
  'co.zeit.hyper',
  'org.tabby',
];
const NO_TERMINAL_COMMAND_SENTINEL = '__NO_COMMAND__';
const NO_SPEECH_HALLUCINATIONS = new Set([
  'you',
  'thank you',
  'thanks',
  'thank you for watching',
  'thanks for watching',
  'bye',
  'goodbye',
]);

function isTerminalFocus(focusInfo: FocusInfo | undefined): boolean {
  const bundleIdentifier = focusInfo?.bundleIdentifier?.toLowerCase() ?? '';
  const appName = focusInfo?.appName?.trim().toLowerCase() ?? '';

  return (
    TERMINAL_APP_NAMES.has(appName) ||
    TERMINAL_BUNDLE_FRAGMENTS.some((fragment) => bundleIdentifier.includes(fragment))
  );
}

function sanitizeTerminalCommand(command: string): string {
  const withoutCodeFence = command
    .trim()
    .replace(/^```(?:\w+)?\s*/u, '')
    .replace(/\s*```$/u, '')
    .trim();

  const unquoted =
    (withoutCodeFence.startsWith('"') && withoutCodeFence.endsWith('"')) ||
    (withoutCodeFence.startsWith("'") && withoutCodeFence.endsWith("'"))
      ? withoutCodeFence.slice(1, -1).trim()
      : withoutCodeFence;

  return unquoted
    .replace(/^\$\s*/u, '')
    .replace(/[\r\n]+/gu, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function isNoSpeechText(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

  return !normalized || NO_SPEECH_HALLUCINATIONS.has(normalized);
}

export async function processDictationAudio({
  wavBase64,
  settings,
  targetFocus,
  forceTerminalCommandMode = false,
  disableTerminalCommandMode = false,
  forceDiagramMode = false,
  setStatus,
}: ProcessDictationOptions): Promise<ProcessAudioResult> {
  const storage = await ensureStorage(settings);

  setStatus({
    phase: 'transcribing',
    title: 'Transcribing',
    detail: `${settings.whisperLabel} is turning your voice into text.`,
  });

  const { transcribeRecording } = await import('./transcription');
  const rawText = await transcribeRecording(wavBase64, settings, storage);
  if (isNoSpeechText(rawText)) {
    setStatus({
      phase: 'done',
      title: 'Nothing heard',
      detail: 'No speech was detected, so nothing was transcribed.',
    });
    setTimeout(() => {
      setStatus(createIdleStatus());
    }, 1_000);

    return {
      rawText: '',
      finalText: '',
      pasted: false,
    };
  }

  const initialFocusInfo = targetFocus ?? (await getFocusInfo().catch(() => undefined));
  const useOpenRouter = settings.textProvider === 'openrouter';
  const activeRewriteModel = useOpenRouter ? settings.openrouterTextModel : settings.textModel;
  const useTerminalCommandMode =
    settings.terminalCommandMode &&
    !forceDiagramMode &&
    !disableTerminalCommandMode &&
    (forceTerminalCommandMode || isTerminalFocus(initialFocusInfo));

  if (useTerminalCommandMode) {
    setStatus({
      phase: 'rewriting',
      title: 'Generating command',
      detail: `${activeRewriteModel} is turning your speech into a terminal command.`,
      preview: rawText,
      rawText,
    });

    let finalText = '';

    try {
      const rewrittenCommand = useOpenRouter
        ? await commandWithOpenRouter(
            settings.openrouterApiKey,
            settings.openrouterTextModel,
            getTerminalCommandPrompt(),
            rawText,
          )
        : await commandWithOllama(
            settings.ollamaBaseUrl,
            settings.textModel,
            getTerminalCommandPrompt(),
            rawText,
          );

      finalText = sanitizeTerminalCommand(rewrittenCommand);
      if (finalText === NO_TERMINAL_COMMAND_SENTINEL) {
        setStatus({
          phase: 'done',
          title: 'No command',
          detail: 'OpenWhisp did not detect a terminal command, so nothing was pasted.',
          preview: rawText,
          rawText,
        });

        setTimeout(() => {
          setStatus(createIdleStatus());
        }, 1_500);

        return {
          rawText,
          finalText: '',
          pasted: false,
          focusInfo: initialFocusInfo,
        };
      }

      if (!finalText) {
        throw new Error('The command model returned an empty command.');
      }
    } catch (error) {
      setStatus({
        phase: 'error',
        title: 'Command unavailable',
        detail:
          error instanceof Error
            ? `${error.message} Nothing was pasted into the terminal.`
            : 'OpenWhisp could not generate a command, so nothing was pasted into the terminal.',
        preview: rawText,
        rawText,
      });

      setTimeout(() => {
        setStatus(createIdleStatus());
      }, 1_500);

      return {
        rawText,
        finalText: '',
        pasted: false,
        focusInfo: initialFocusInfo,
      };
    }

    clipboard.writeText(finalText);

    let pasted = false;
    if (settings.autoPaste) {
      setStatus({
        phase: 'pasting',
        title: 'Pasting command',
        detail: 'Sending the command to the terminal without pressing Enter.',
        preview: finalText,
        rawText,
      });

      pasted = await triggerPaste(initialFocusInfo).catch(() => false);
    }

    setStatus({
      phase: 'done',
      title: pasted ? 'Command pasted' : 'Command copied',
      detail: pasted
        ? 'Review the command in your terminal, then press Enter when you are ready.'
        : 'The command is on the clipboard. Paste it into your terminal when you are ready.',
      preview: finalText,
      rawText,
    });

    setTimeout(() => {
      setStatus(createIdleStatus());
    }, 1_500);

    return {
      rawText,
      finalText,
      pasted,
      focusInfo: initialFocusInfo,
    };
  }

  if (forceDiagramMode) {
    setStatus({
      phase: 'rewriting',
      title: 'Building diagram',
      detail: `${activeRewriteModel} is mapping your idea into an editable diagram.`,
      preview: rawText,
      rawText,
    });

    try {
      const diagramDraft = await generateDiagramDraft(settings, rawText);
      setStatus({
        phase: 'done',
        title: 'Diagram ready',
        detail: 'Review and edit the diagram before copying or saving it as a PNG.',
        preview: diagramDraft.title,
        rawText,
      });

      setTimeout(() => {
        setStatus(createIdleStatus());
      }, 1_500);

      return {
        rawText,
        finalText: '',
        pasted: false,
        focusInfo: initialFocusInfo,
        diagramDraft,
        mindmapDraft: diagramDraft,
      };
    } catch (error) {
      setStatus({
        phase: 'error',
        title: 'Diagram unavailable',
        detail:
          error instanceof Error
            ? `${error.message} Nothing was pasted.`
            : 'OpenWhisp could not create the diagram, so nothing was pasted.',
        preview: rawText,
        rawText,
      });

      setTimeout(() => {
        setStatus(createIdleStatus());
      }, 1_500);

      return {
        rawText,
        finalText: '',
        pasted: false,
        focusInfo: initialFocusInfo,
      };
    }
  }

  setStatus({
    phase: 'rewriting',
    title: 'Polishing',
    detail: useOpenRouter
      ? `${activeRewriteModel} is polishing your dictation via OpenRouter.`
      : `${activeRewriteModel} is applying the selected rewrite level. The first request can take a moment while Ollama warms the model.`,
    preview: rawText,
    rawText,
  });

  let finalText = rawText;
  let usedRewriteFallback = false;

  try {
    finalText = useOpenRouter
      ? await rewriteWithOpenRouter(
          settings.openrouterApiKey,
          settings.openrouterTextModel,
          getEnhancementPrompt(settings.styleMode, settings.enhancementLevel),
          rawText,
        )
      : await rewriteWithOllama(
          settings.ollamaBaseUrl,
          settings.textModel,
          getEnhancementPrompt(settings.styleMode, settings.enhancementLevel),
          rawText,
        );
  } catch (error) {
    usedRewriteFallback = true;
    setStatus({
      phase: 'error',
      title: 'Rewrite unavailable',
      detail:
        error instanceof Error
          ? `${error.message} OpenWhisp will use the raw transcription for now.`
          : 'OpenWhisp could not finish the rewrite pass, so it will use the raw transcription.',
      preview: rawText,
      rawText,
    });
  }

  let image: ImageGenerationResult | undefined;
  let imageError: string | undefined;
  let imageNote: string | undefined;

  const triggerHeard = detectImageTrigger(rawText) || detectImageTrigger(finalText);
  if (triggerHeard && !settings.imageAgent.enabled) {
    imageNote = 'Image AI is OFF in Models › Image AI. Toggle it on to generate.';
    console.log('[dictation] image trigger heard but image agent disabled');
  } else if (triggerHeard && !settings.openrouterApiKey) {
    imageNote = 'Add an OpenRouter API key in Models to enable image generation.';
    console.log('[dictation] image trigger heard but no OpenRouter API key');
  }

  if (settings.imageAgent.enabled && settings.openrouterApiKey) {
    try {
      const agentResult = await runImageAgent({
        settings,
        rawText,
        rewrittenText: finalText,
        setStatus,
      });
      finalText = agentResult.finalText;
      image = agentResult.image;
      if (!image && agentResult.decisionReason) {
        imageNote = agentResult.decisionReason;
      }
    } catch (error) {
      imageError =
        error instanceof Error ? error.message : 'Image generation failed.';
      console.error('[dictation] image agent threw:', imageError);
      setStatus({
        phase: 'error',
        title: 'Image generation failed',
        detail: `${imageError} OpenWhisp will paste the dictation only.`,
        preview: finalText,
        rawText,
      });
    }
  }

  clipboard.writeText(finalText);

  let pasted = false;
  const focusInfo = initialFocusInfo;

  if (settings.autoPaste) {
    setStatus({
      phase: 'pasting',
      title: 'Pasting',
      detail: 'Sending the polished text to the active app.',
      preview: finalText,
      rawText,
    });

    pasted = await triggerPaste(focusInfo).catch(() => false);
  }

  const doneTitle = image ? (pasted ? 'Image pasted' : 'Image copied') : pasted ? 'Pasted' : 'Copied';
  const doneDetail = image
    ? pasted
      ? `Pasted "${image.prompt.slice(0, 60)}" via ${image.model}.`
      : 'Image URL is on the clipboard. Paste it where you need it.'
    : usedRewriteFallback
      ? pasted
        ? 'The raw transcription was pasted because the rewrite model was unavailable.'
        : 'The raw transcription is on the clipboard because the rewrite model was unavailable.'
      : pasted
        ? 'The refined text was pasted into the active app.'
        : focusInfo?.appName
          ? `OpenWhisp copied the text, but it could not paste into ${focusInfo.appName}.`
          : 'The refined text is on the clipboard.';

  const detailWithNotes = imageError
    ? `${doneDetail} (${imageError})`
    : imageNote
      ? `${doneDetail} (image agent: ${imageNote})`
      : doneDetail;

  setStatus({
    phase: 'done',
    title: doneTitle,
    detail: detailWithNotes,
    preview: finalText,
    rawText,
    imageUrl: image?.url,
  });

  setTimeout(() => {
    setStatus(createIdleStatus());
  }, 1_500);

  return {
    rawText,
    finalText,
    pasted,
    focusInfo,
    image,
  };
}

export function getInitialStatus(): AppStatus {
  return createIdleStatus();
}
