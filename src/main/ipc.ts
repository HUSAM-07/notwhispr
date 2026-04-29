import { ipcMain, shell } from 'electron';

import type {
  AppSettings,
  AppStatus,
  BootstrapState,
  DictationRequest,
  OpenRouterModelInfo,
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
      detail: 'Hold Fn to dictate. Release Fn to paste.',
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
      detail: 'Hold Fn to dictate. Release Fn to paste.',
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
      setStatus: dependencies.setStatus,
    }),
  );

  ipcMain.on('dictation:status', (_event, status: AppStatus) => {
    dependencies.setStatus(status);
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
