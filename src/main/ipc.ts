import { writeFile } from 'node:fs/promises';

import { clipboard, dialog, ipcMain, nativeImage, shell } from 'electron';

import type {
  AppSettings,
  AppStatus,
  BootstrapState,
  CopyMindmapPngResult,
  DictationRequest,
  MindmapPngRequest,
  MindmapPreviewRequest,
  OpenRouterModelInfo,
  SaveMindmapPngResult,
  UpdateSettingsInput,
} from '../shared/types';
import { RECOMMENDED_TEXT_MODEL } from '../shared/recommendations';
import { processDictationAudio } from './dictation';
import { applyLaunchAtLogin } from './login-item';
import { pullOllamaModel, listOllamaModels, isOllamaReachable, ensureOllamaRunning } from './ollama';
import { listCuratedTextModels, listImageModels, verifyApiKey } from './openrouter';
import { isImageStorageReady } from './supabase-storage';
import { getFocusInfo } from './native-helper';
import { getPermissionState, requestMicrophoneAccess, requestSystemAccess } from './permissions';
import { updateSettings as persistSettings, chooseStorageDirectory } from './settings';
import { directoryHasEntries, ensureStorage } from './storage';

interface IpcDependencies {
  getSettings: () => AppSettings;
  setSettings: (settings: AppSettings) => void;
  getStatus: () => AppStatus;
  setStatus: (status: AppStatus) => void;
  getHelperReady: () => boolean;
  showMainWindow: () => void;
  hideMainWindow: () => void;
  openMindmapPreview: (request: MindmapPreviewRequest) => Promise<void>;
  getMindmapPreview: () => MindmapPreviewRequest | null;
  closeMindmapPreview: () => void;
  ensureHotkeyListener: () => Promise<void>;
}

export function registerIpcHandlers(dependencies: IpcDependencies): void {
  const buildBootstrapState = async (): Promise<BootstrapState> => {
    const settings = dependencies.getSettings();
    const storage = await ensureStorage(settings);
    const permissions = await getPermissionState();
    if (permissions.accessibility && permissions.inputMonitoring && permissions.postEvents) {
      await dependencies.ensureHotkeyListener();
    }
    const ollamaReachable = await ensureOllamaRunning(settings.ollamaBaseUrl);
    const ollamaModels = ollamaReachable ? await listOllamaModels(settings.ollamaBaseUrl) : [];

    const recommendedModelInstalled = ollamaModels.some(
      (model) => model.name === settings.textModel || model.name === RECOMMENDED_TEXT_MODEL,
    );
    const textProviderReady =
      settings.textProvider === 'openrouter'
        ? Boolean(settings.openrouterApiKey && settings.openrouterTextModel)
        : settings.textProvider === 'litellm'
          ? Boolean(settings.litellmBaseUrl && settings.litellmApiKey && settings.litellmTextModel)
          : ollamaReachable && recommendedModelInstalled;

    return {
      settings,
      permissions,
      ollamaReachable,
      ollamaModels,
      recommendedModelInstalled,
      speechModelReady: await directoryHasEntries(storage.models),
      helperReady: dependencies.getHelperReady(),
      status: dependencies.getStatus(),
      imageStorageReady: isImageStorageReady(settings.imageStorage),
      textProviderReady,
    };
  };

  ipcMain.handle('app:bootstrap', buildBootstrapState);

  ipcMain.handle('settings:update', async (_event, updates: UpdateSettingsInput) => {
    const nextSettings = await persistSettings(dependencies.getSettings(), updates);
    await ensureStorage(nextSettings);
    applyLaunchAtLogin(nextSettings.launchAtLogin);
    dependencies.setSettings(nextSettings);
    return buildBootstrapState();
  });

  ipcMain.handle('settings:chooseStorage', async () => {
    const selected = await chooseStorageDirectory(dependencies.getSettings().storageDirectory);
    if (!selected) {
      return buildBootstrapState();
    }

    const nextSettings = await persistSettings(dependencies.getSettings(), {
      storageDirectory: selected,
    });

    await ensureStorage(nextSettings);
    dependencies.setSettings(nextSettings);
    return buildBootstrapState();
  });

  ipcMain.handle('permissions:requestMicrophone', async () => {
    await requestMicrophoneAccess();
    return buildBootstrapState();
  });

  ipcMain.handle('permissions:requestSystem', async () => {
    await requestSystemAccess();
    await dependencies.ensureHotkeyListener();
    return buildBootstrapState();
  });

  ipcMain.handle('models:prepareSpeech', async () => {
    const settings = dependencies.getSettings();
    dependencies.setStatus({
      phase: 'transcribing',
      title: 'Preparing speech model',
      detail: 'Downloading and warming the local Whisper model.',
    });

    const storage = await ensureStorage(settings);
    const { prepareTranscriber } = await import('./transcription');
    await prepareTranscriber(settings, storage);

    dependencies.setStatus({
      phase: 'idle',
      title: 'Ready',
      detail: 'Hold Option to dictate. Release Option to paste.',
    });

    return buildBootstrapState();
  });

  ipcMain.handle('models:refreshOllama', buildBootstrapState);

  ipcMain.handle('models:pullRecommended', async () => {
    const settings = dependencies.getSettings();
    if (!(await isOllamaReachable(settings.ollamaBaseUrl))) {
      throw new Error(
        `Ollama is not running at ${settings.ollamaBaseUrl}. Start the Ollama app or run \`ollama serve\`, then try again.`,
      );
    }

    dependencies.setStatus({
      phase: 'rewriting',
      title: 'Downloading model',
      detail: `Pulling ${RECOMMENDED_TEXT_MODEL} from Ollama.`,
    });

    await pullOllamaModel(settings.ollamaBaseUrl, RECOMMENDED_TEXT_MODEL, (detail) => {
      dependencies.setStatus({
        phase: 'rewriting',
        title: 'Downloading model',
        detail,
      });
    });

    dependencies.setStatus({
      phase: 'idle',
      title: 'Ready',
      detail: 'Hold Option to dictate. Release Option to paste.',
    });

    return buildBootstrapState();
  });

  ipcMain.handle('dictation:captureTarget', async () => getFocusInfo());

  ipcMain.handle('dictation:processAudio', async (_event, request: DictationRequest) =>
    processDictationAudio({
      wavBase64: request.wavBase64,
      settings: dependencies.getSettings(),
      targetFocus: request.targetFocus,
      forceTerminalCommandMode: request.forceTerminalCommandMode,
      disableTerminalCommandMode: request.disableTerminalCommandMode,
      forceDiagramMode: request.forceDiagramMode,
      setStatus: dependencies.setStatus,
    }),
  );

  ipcMain.on('dictation:status', (_event, status: AppStatus) => {
    dependencies.setStatus(status);
  });

  ipcMain.handle('mindmap:openPreview', async (_event, request: MindmapPreviewRequest) => {
    await dependencies.openMindmapPreview(request);
  });

  ipcMain.handle('mindmap:getPreview', async (): Promise<MindmapPreviewRequest | null> =>
    dependencies.getMindmapPreview(),
  );

  ipcMain.handle('mindmap:copyPng', async (_event, request: MindmapPngRequest): Promise<CopyMindmapPngResult> => {
    const image = readMindmapPng(request.dataUrl);
    clipboard.writeImage(image);
    dependencies.closeMindmapPreview();
    return { copied: true };
  });

  ipcMain.handle('mindmap:savePng', async (_event, request: MindmapPngRequest): Promise<SaveMindmapPngResult> => {
    const image = readMindmapPng(request.dataUrl);
    const result = await dialog.showSaveDialog({
      title: 'Save mindmap PNG',
      defaultPath: `${sanitizeFilename(request.title || 'mindmap')}.png`,
      filters: [{ name: 'PNG Image', extensions: ['png'] }],
    });
    if (result.canceled || !result.filePath) return { saved: false };

    await writeFile(result.filePath, image.toPNG());
    return { saved: true, filePath: result.filePath };
  });

  ipcMain.handle('mindmap:cancel', () => {
    dependencies.closeMindmapPreview();
  });

  ipcMain.handle('system:showMainWindow', () => {
    dependencies.showMainWindow();
  });

  ipcMain.handle('system:hideMainWindow', () => {
    dependencies.hideMainWindow();
  });

  ipcMain.handle('system:openExternal', async (_event, targetUrl: string) => {
    await shell.openExternal(targetUrl);
  });

  ipcMain.handle('system:revealStorage', async () => {
    await shell.openPath(dependencies.getSettings().storageDirectory);
  });

  ipcMain.handle(
    'imageAgent:listModels',
    async (_event, apiKey: string): Promise<OpenRouterModelInfo[]> => {
      const key = apiKey || dependencies.getSettings().openrouterApiKey;
      return listImageModels(key);
    },
  );

  ipcMain.handle(
    'imageAgent:verifyKey',
    async (_event, apiKey: string): Promise<boolean> => verifyApiKey(apiKey),
  );

  ipcMain.handle(
    'openrouter:listTextModels',
    async (): Promise<OpenRouterModelInfo[]> => listCuratedTextModels(),
  );
}

function readMindmapPng(dataUrl: string) {
  if (!dataUrl.startsWith('data:image/png;base64,')) {
    throw new Error('Mindmap export must be a PNG data URL.');
  }

  const image = nativeImage.createFromDataURL(dataUrl);
  if (image.isEmpty()) {
    throw new Error('OpenWhisp could not read the exported mindmap image.');
  }
  return image;
}

function sanitizeFilename(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'mindmap';
}
