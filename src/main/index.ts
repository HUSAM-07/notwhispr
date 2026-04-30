import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getInitialStatus } from './dictation';
import { registerIpcHandlers } from './ipc';
import { applyLaunchAtLogin } from './login-item';
import {
  ensureNativeHelper,
  isFnListenerRunning,
  startFnListener,
  stopFnListener,
} from './native-helper';
import { getPermissionState } from './permissions';
import { loadSettings } from './settings';
import { ensureStorage } from './storage';
import { createMainWindow, createMindmapWindow, createOverlayWindow, positionOverlayWindow } from './windows';
import type { AppSettings, AppStatus, MindmapPreviewRequest } from '../shared/types';

const projectRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let mindmapWindow: BrowserWindow | null = null;
let pendingMindmapPreview: MindmapPreviewRequest | null = null;
let tray: Tray | null = null;
let settings: AppSettings;
let status: AppStatus = getInitialStatus();
let helperReady = false;
let isQuitting = false;
let suppressMainWindowUntil = 0;

function isDisconnectedTerminalWrite(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const code = (error as NodeJS.ErrnoException).code;
  return code === 'EIO' || code === 'EPIPE' || code === 'EBADF';
}

function installConsoleWriteGuard(): void {
  process.on('uncaughtException', (error) => {
    if (isDisconnectedTerminalWrite(error)) {
      return;
    }

    throw error;
  });

  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', (error) => {
      if (!isDisconnectedTerminalWrite(error)) {
        throw error;
      }
    });
  }

  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      try {
        original(...args);
      } catch (error) {
        if (!isDisconnectedTerminalWrite(error)) {
          throw error;
        }
      }
    };
  }
}

function shutdown(): void {
  if (isQuitting) {
    return;
  }

  isQuitting = true;
  stopFnListener();
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of [mainWindow, overlayWindow]) {
    if (window && !window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}

async function ensureOverlayWindow(): Promise<BrowserWindow | null> {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return overlayWindow;
  }

  overlayWindow = await createOverlayWindow();
  attachWindowDiagnostics(overlayWindow, 'overlay');
  return overlayWindow;
}

async function showOverlay(): Promise<void> {
  const window = await ensureOverlayWindow();
  if (!window || window.isDestroyed()) {
    return;
  }

  positionOverlayWindow(window);
  window.setIgnoreMouseEvents(status.phase !== 'listening');
  window.showInactive();
}

function hideOverlay(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
  }
}

function setStatus(nextStatus: AppStatus): void {
  status = nextStatus;
  broadcast('app:status', nextStatus);
  overlayWindow?.setIgnoreMouseEvents(nextStatus.phase !== 'listening');

  if (nextStatus.phase === 'idle') {
    suppressMainWindowUntil = Date.now() + 1_500;
  }

  if (settings.showOverlay || nextStatus.phase !== 'idle') {
    void showOverlay();
  } else {
    hideOverlay();
  }
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

function hideMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.hide();
}

function suppressMainWindowForOverlayFlow(): void {
  suppressMainWindowUntil = Date.now() + 10 * 60_000;
  hideMainWindow();
}

async function ensureMindmapWindow(): Promise<BrowserWindow | null> {
  if (mindmapWindow && !mindmapWindow.isDestroyed()) {
    return mindmapWindow;
  }

  mindmapWindow = await createMindmapWindow();
  attachWindowDiagnostics(mindmapWindow, 'mindmap');
  mindmapWindow.on('closed', () => {
    mindmapWindow = null;
  });
  mindmapWindow.on('ready-to-show', () => {
    mindmapWindow?.show();
    mindmapWindow?.focus();
  });
  return mindmapWindow;
}

async function openMindmapPreview(request: MindmapPreviewRequest): Promise<void> {
  pendingMindmapPreview = request;
  const window = await ensureMindmapWindow();
  if (!window || window.isDestroyed()) return;

  if (window.webContents.isLoading()) {
    window.webContents.once('did-finish-load', () => {
      window.webContents.send('mindmap:previewUpdated', pendingMindmapPreview);
    });
  } else {
    window.webContents.send('mindmap:previewUpdated', pendingMindmapPreview);
  }

  window.show();
  window.focus();
}

function getMindmapPreview(): MindmapPreviewRequest | null {
  return pendingMindmapPreview;
}

function closeMindmapPreview(): void {
  pendingMindmapPreview = null;
  if (mindmapWindow && !mindmapWindow.isDestroyed()) {
    mindmapWindow.close();
  }
}

function attachWindowDiagnostics(window: BrowserWindow, label: string): void {
  window.webContents.on('did-finish-load', () => {
    console.log(`[openwhisp] ${label} did-finish-load`);
  });

  window.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL) => {
      console.error(
        `[openwhisp] ${label} did-fail-load`,
        JSON.stringify({ errorCode, errorDescription, validatedURL }),
      );
    },
  );

  window.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[openwhisp] ${label} render-process-gone`, JSON.stringify(details));
  });

  window.on('unresponsive', () => {
    console.error(`[openwhisp] ${label} unresponsive`);
  });
}

async function ensureHotkeyListener(): Promise<void> {
  if (!helperReady || isFnListenerRunning()) {
    return;
  }

  const permissions = await getPermissionState();
  if (
    !permissions.accessibility ||
    !permissions.inputMonitoring ||
    !permissions.postEvents
  ) {
    return;
  }

  await startFnListener(
    (event) => {
      broadcast('hotkey:event', event);

      if (event.type === 'down') {
        suppressMainWindowForOverlayFlow();
        void showOverlay();
      }
    },
    (message) => {
      setStatus({
        phase: 'error',
        title: 'Option key unavailable',
        detail: message,
      });
    },
  );
}

async function createWindows(): Promise<void> {
  mainWindow = await createMainWindow();
  attachWindowDiagnostics(mainWindow, 'main');

  mainWindow.on('ready-to-show', () => {
    showMainWindow();
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) {
      return;
    }

    if (!app.isPackaged) {
      shutdown();
      return;
    }

    event.preventDefault();
    mainWindow?.hide();
  });

  showMainWindow();
}

async function bootstrap(): Promise<void> {
  settings = await loadSettings();
  await ensureStorage(settings);
  applyLaunchAtLogin(settings.launchAtLogin);

  registerIpcHandlers({
    getSettings: () => settings,
    setSettings: (nextSettings) => {
      settings = nextSettings;
    },
    getStatus: () => status,
    setStatus,
    getHelperReady: () => helperReady,
    showMainWindow,
    hideMainWindow,
    openMindmapPreview,
    getMindmapPreview,
    closeMindmapPreview,
    ensureHotkeyListener,
  });

  await createWindows();
  await ensureOverlayWindow();
  if (settings.showOverlay) void showOverlay();
  createTray();

  helperReady = await ensureNativeHelper();

  await ensureHotkeyListener();
}

function getTrayIconPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'icons', 'trayTemplate.png');
  }
  return path.join(projectRoot, 'build', 'icons', 'trayTemplate.png');
}

function createTray(): void {
  const icon = nativeImage.createFromPath(getTrayIconPath());
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Openwhisp');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Openwhisp', click: () => showMainWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => showMainWindow());
}

installConsoleWriteGuard();

app.whenReady().then(bootstrap);

app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (_consoleEvent, level, message) => {
    if (!app.isPackaged) {
      console.log(`[openwhisp:renderer:${level}] ${message}`);
    }
  });
});

app.on('activate', () => {
  if (
    status.phase !== 'idle' ||
    Date.now() < suppressMainWindowUntil ||
    (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible())
  ) {
    return;
  }

  showMainWindow();
});

app.on('will-quit', () => {
  shutdown();
});

app.on('before-quit', () => {
  shutdown();
});

process.on('SIGINT', () => {
  shutdown();
  app.quit();
});

process.on('SIGTERM', () => {
  shutdown();
  app.quit();
});

process.on('exit', () => {
  stopFnListener();
});
