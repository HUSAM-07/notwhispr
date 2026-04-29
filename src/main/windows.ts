import { fileURLToPath } from 'node:url';

import { BrowserWindow, screen } from 'electron';

const preloadPath = fileURLToPath(new URL('../preload/index.cjs', import.meta.url));
const rendererFilePath = fileURLToPath(new URL('../renderer/index.html', import.meta.url));
const overlayWidth = 460;
const overlayHeight = 156;

function getRendererEntry(hash = ''): string {
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    return hash ? `${rendererUrl.replace(/\/$/, '')}/#${hash}` : rendererUrl;
  }

  return rendererFilePath + (hash ? `#${hash}` : '');
}

async function loadRendererWindow(window: BrowserWindow, hash = ''): Promise<void> {
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;

  if (rendererUrl) {
    await window.loadURL(getRendererEntry(hash));
    return;
  }

  await window.loadFile(rendererFilePath, {
    hash,
  });
}

export async function createMainWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1060,
    height: 720,
    minWidth: 800,
    minHeight: 520,
    show: false,
    backgroundColor: '#f5f5ef',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: {
      x: 18,
      y: 18,
    },
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  await loadRendererWindow(window);
  return window;
}

export function positionOverlayWindow(window: BrowserWindow): void {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const workArea = display.workArea;
  const margin = 24;

  const x = workArea.x + Math.round((workArea.width - overlayWidth) / 2);
  const y = workArea.y + workArea.height - overlayHeight - margin;

  window.setBounds({ x, y, width: overlayWidth, height: overlayHeight });
}

export async function createOverlayWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: overlayWidth,
    height: overlayHeight,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.setAlwaysOnTop(true, 'floating');
  window.setIgnoreMouseEvents(true);
  positionOverlayWindow(window);

  await loadRendererWindow(window, 'overlay');

  return window;
}

export async function createMindmapWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    show: false,
    backgroundColor: '#f5f5ef',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: {
      x: 18,
      y: 18,
    },
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  await loadRendererWindow(window, 'mindmap');
  return window;
}
