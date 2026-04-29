/// <reference types="vite/client" />

import type {
  AppStatus,
  BootstrapState,
  CopyMindmapPngResult,
  DictationRequest,
  FocusInfo,
  HotkeyEvent,
  ImageGenerationResult,
  MindmapPngRequest,
  MindmapPreviewRequest,
  OpenRouterModelInfo,
  SaveMindmapPngResult,
  UpdateSettingsInput,
} from '../shared/types';

declare global {
  interface Window {
    openWhisp: {
      bootstrap: () => Promise<BootstrapState>;
      updateSettings: (updates: UpdateSettingsInput) => Promise<BootstrapState>;
      chooseStorage: () => Promise<BootstrapState>;
      requestMicrophoneAccess: () => Promise<BootstrapState>;
      requestSystemAccess: () => Promise<BootstrapState>;
      prepareSpeechModel: () => Promise<BootstrapState>;
      refreshOllama: () => Promise<BootstrapState>;
      pullRecommendedModel: () => Promise<BootstrapState>;
      captureFocusTarget: () => Promise<FocusInfo>;
      processAudio: (request: DictationRequest) => Promise<{
        rawText: string;
        finalText: string;
        pasted: boolean;
        image?: ImageGenerationResult;
        diagramDraft?: MindmapPreviewRequest['draft'];
        mindmapDraft?: MindmapPreviewRequest['draft'];
      }>;
      openMindmapPreview: (request: MindmapPreviewRequest) => Promise<void>;
      getMindmapPreview: () => Promise<MindmapPreviewRequest | null>;
      copyMindmapPng: (request: MindmapPngRequest) => Promise<CopyMindmapPngResult>;
      saveMindmapPng: (request: MindmapPngRequest) => Promise<SaveMindmapPngResult>;
      cancelMindmapPreview: () => Promise<void>;
      onMindmapPreview: (listener: (request: MindmapPreviewRequest | null) => void) => () => void;
      listImageModels: (apiKey: string) => Promise<OpenRouterModelInfo[]>;
      verifyImageApiKey: (apiKey: string) => Promise<boolean>;
      listOpenRouterTextModels: () => Promise<OpenRouterModelInfo[]>;
      pushStatus: (status: AppStatus) => void;
      showMainWindow: () => Promise<void>;
      hideMainWindow: () => Promise<void>;
      openExternal: (targetUrl: string) => Promise<void>;
      revealStorage: () => Promise<void>;
      onStatus: (listener: (status: AppStatus) => void) => () => void;
      onHotkey: (listener: (event: HotkeyEvent) => void) => () => void;
    };
  }
}

export {};
