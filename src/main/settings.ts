import { dialog, app } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createDefaultSettings } from './defaults';
import type { AppSettings, UpdateSettingsInput } from '../shared/types';

const SETTINGS_FILE = 'settings.json';

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), SETTINGS_FILE);
}

export async function loadSettings(): Promise<AppSettings> {
  const settingsPath = getSettingsPath();
  const defaults = createDefaultSettings();

  try {
    const raw = await readFile(settingsPath, 'utf8');
    const persisted = JSON.parse(raw) as Partial<AppSettings> & {
      warpCommandMode?: boolean;
    };

    const migratedKey =
      persisted.openrouterApiKey || persisted.imageAgent?.openrouterApiKey || '';
    const terminalCommandMode =
      persisted.terminalCommandMode ?? persisted.warpCommandMode ?? defaults.terminalCommandMode;

    return {
      ...defaults,
      ...persisted,
      openrouterApiKey: migratedKey,
      terminalCommandMode,
      imageAgent: {
        ...defaults.imageAgent,
        ...(persisted.imageAgent ?? {}),
        openrouterApiKey: undefined,
      },
      imageStorage: {
        ...defaults.imageStorage,
        ...(persisted.imageStorage ?? {}),
      },
    };
  } catch {
    await saveSettings(defaults);
    return defaults;
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const settingsPath = getSettingsPath();
  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

export async function updateSettings(
  current: AppSettings,
  updates: UpdateSettingsInput,
): Promise<AppSettings> {
  const { imageAgent: imageAgentUpdate, imageStorage: imageStorageUpdate, ...rest } = updates;
  const nextSettings: AppSettings = {
    ...current,
    ...rest,
    imageAgent: {
      ...current.imageAgent,
      ...(imageAgentUpdate ?? {}),
    },
    imageStorage: {
      ...current.imageStorage,
      ...(imageStorageUpdate ?? {}),
    },
  };

  await saveSettings(nextSettings);
  return nextSettings;
}

export async function chooseStorageDirectory(currentDirectory: string): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: 'Choose storage folder',
    defaultPath: currentDirectory,
    properties: ['openDirectory', 'createDirectory'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
}
