import { app } from 'electron';
import path from 'node:path';

import type { AppSettings, EnhancementLevel } from '../shared/types';
import {
  RECOMMENDED_TEXT_MODEL,
  RECOMMENDED_WHISPER_LABEL,
  RECOMMENDED_WHISPER_MODEL,
} from '../shared/recommendations';

export const APP_NAME = 'OpenWhisp';

export const ENHANCEMENT_LABELS: Record<EnhancementLevel, string> = {
  none: 'No filter',
  soft: 'Soft',
  medium: 'Medium',
  high: 'High',
};

export function getDefaultStorageDirectory(): string {
  return path.join(app.getPath('documents'), APP_NAME);
}

export const RECOMMENDED_IMAGE_MODEL = 'google/gemini-2.5-flash-image';
export const RECOMMENDED_OPENROUTER_TEXT_MODEL = 'google/gemini-2.5-flash-lite';

export function createDefaultSettings(): AppSettings {
  return {
    storageDirectory: getDefaultStorageDirectory(),
    whisperModel: RECOMMENDED_WHISPER_MODEL,
    whisperLabel: RECOMMENDED_WHISPER_LABEL,
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    textProvider: 'ollama',
    textModel: RECOMMENDED_TEXT_MODEL,
    openrouterApiKey: '',
    openrouterTextModel: RECOMMENDED_OPENROUTER_TEXT_MODEL,
    litellmBaseUrl: 'http://127.0.0.1:4000/v1',
    litellmApiKey: '',
    litellmTextModel: '',
    styleMode: 'conversation',
    enhancementLevel: 'medium',
    autoPaste: true,
    terminalCommandMode: true,
    showOverlay: false,
    launchAtLogin: true,
    setupComplete: false,
    imageAgent: {
      enabled: false,
      imageModel: RECOMMENDED_IMAGE_MODEL,
    },
    imageStorage: {
      url: '',
      publishableKey: '',
      secretKey: '',
      bucket: '',
    },
  };
}
