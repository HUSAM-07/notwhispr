import { contextBridge, ipcRenderer } from 'electron';

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

const api = {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap') as Promise<BootstrapState>,
  updateSettings: (updates: UpdateSettingsInput) =>
    ipcRenderer.invoke('settings:update', updates) as Promise<BootstrapState>,
  chooseStorage: () => ipcRenderer.invoke('settings:chooseStorage') as Promise<BootstrapState>,
  requestMicrophoneAccess: () =>
    ipcRenderer.invoke('permissions:requestMicrophone') as Promise<BootstrapState>,
  requestSystemAccess: () =>
    ipcRenderer.invoke('permissions:requestSystem') as Promise<BootstrapState>,
  prepareSpeechModel: () =>
    ipcRenderer.invoke('models:prepareSpeech') as Promise<BootstrapState>,
  refreshOllama: () => ipcRenderer.invoke('models:refreshOllama') as Promise<BootstrapState>,
  pullRecommendedModel: () =>
    ipcRenderer.invoke('models:pullRecommended') as Promise<BootstrapState>,
  captureFocusTarget: () =>
    ipcRenderer.invoke('dictation:captureTarget') as Promise<FocusInfo>,
  processAudio: (request: DictationRequest) =>
    ipcRenderer.invoke('dictation:processAudio', request) as Promise<{
      rawText: string;
      finalText: string;
      pasted: boolean;
      image?: ImageGenerationResult;
      diagramDraft?: MindmapPreviewRequest['draft'];
      mindmapDraft?: MindmapPreviewRequest['draft'];
    }>,
  listImageModels: (apiKey: string) =>
    ipcRenderer.invoke('imageAgent:listModels', apiKey) as Promise<OpenRouterModelInfo[]>,
  verifyImageApiKey: (apiKey: string) =>
    ipcRenderer.invoke('imageAgent:verifyKey', apiKey) as Promise<boolean>,
  listOpenRouterTextModels: () =>
    ipcRenderer.invoke('openrouter:listTextModels') as Promise<OpenRouterModelInfo[]>,
  pushStatus: (status: AppStatus) => ipcRenderer.send('dictation:status', status),
  openMindmapPreview: (request: MindmapPreviewRequest) =>
    ipcRenderer.invoke('mindmap:openPreview', request) as Promise<void>,
  getMindmapPreview: () =>
    ipcRenderer.invoke('mindmap:getPreview') as Promise<MindmapPreviewRequest | null>,
  copyMindmapPng: (request: MindmapPngRequest) =>
    ipcRenderer.invoke('mindmap:copyPng', request) as Promise<CopyMindmapPngResult>,
  saveMindmapPng: (request: MindmapPngRequest) =>
    ipcRenderer.invoke('mindmap:savePng', request) as Promise<SaveMindmapPngResult>,
  cancelMindmapPreview: () => ipcRenderer.invoke('mindmap:cancel') as Promise<void>,
  onMindmapPreview: (listener: (request: MindmapPreviewRequest | null) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, request: MindmapPreviewRequest | null) =>
      listener(request);
    ipcRenderer.on('mindmap:previewUpdated', wrapped);
    return () => ipcRenderer.removeListener('mindmap:previewUpdated', wrapped);
  },
  showMainWindow: () => ipcRenderer.invoke('system:showMainWindow'),
  hideMainWindow: () => ipcRenderer.invoke('system:hideMainWindow'),
  openExternal: (targetUrl: string) => ipcRenderer.invoke('system:openExternal', targetUrl),
  revealStorage: () => ipcRenderer.invoke('system:revealStorage'),
  onStatus: (listener: (status: AppStatus) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, status: AppStatus) => listener(status);
    ipcRenderer.on('app:status', wrapped);
    return () => ipcRenderer.removeListener('app:status', wrapped);
  },
  onHotkey: (listener: (event: HotkeyEvent) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, event: HotkeyEvent) => listener(event);
    ipcRenderer.on('hotkey:event', wrapped);
    return () => ipcRenderer.removeListener('hotkey:event', wrapped);
  },
};

contextBridge.exposeInMainWorld('openWhisp', api);
