import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { app } from 'electron';

import type { FocusInfo, HotkeyEvent, PermissionsState } from '../shared/types';
import { pathExists } from './storage';

const projectRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const helperSourcePath = path.join(projectRoot, 'swift', 'OpenWhispHelper.swift');

type ListenerProcess = ChildProcessByStdio<null, Readable, Readable>;

let listenerProcess: ListenerProcess | null = null;

function getHelperBinaryPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'native', 'openwhisp-helper')
    : path.join(projectRoot, 'build', 'native', 'openwhisp-helper');
}

async function compileHelper(): Promise<boolean> {
  if (app.isPackaged) {
    return pathExists(getHelperBinaryPath());
  }

  const outputPath = getHelperBinaryPath();
  const outputDirectory = path.dirname(outputPath);
  await mkdir(outputDirectory, { recursive: true });

  return new Promise<boolean>((resolve) => {
    const child = spawn('swiftc', [helperSourcePath, '-o', outputPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

export async function ensureNativeHelper(): Promise<boolean> {
  if (await pathExists(getHelperBinaryPath())) {
    return true;
  }

  if (!(await pathExists(helperSourcePath))) {
    return false;
  }

  return compileHelper();
}

async function runHelperJson<T>(args: string[]): Promise<T> {
  const helperReady = await ensureNativeHelper();
  if (!helperReady) {
    throw new Error('The native OpenWhisp helper is not available.');
  }

  return new Promise<T>((resolve, reject) => {
    const child = spawn(getHelperBinaryPath(), args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || 'The helper exited unexpectedly.'));
        return;
      }

      try {
        resolve(JSON.parse(stdout.trim()) as T);
      } catch (error) {
        reject(error);
      }
    });
  });
}

export async function getNativePermissionState(): Promise<PermissionsState> {
  try {
    return await runHelperJson<PermissionsState>(['permissions', 'status']);
  } catch {
    return {
      accessibility: false,
      inputMonitoring: false,
      postEvents: false,
      microphone: 'unknown',
    };
  }
}

export async function requestNativePermissions(): Promise<PermissionsState> {
  try {
    return await runHelperJson<PermissionsState>(['permissions', 'request']);
  } catch {
    return getNativePermissionState();
  }
}

export async function getFocusInfo(): Promise<FocusInfo> {
  return runHelperJson<FocusInfo>(['focus']);
}

export async function triggerPaste(targetFocus?: FocusInfo): Promise<boolean> {
  const args = ['paste'];

  if (targetFocus?.bundleIdentifier || typeof targetFocus?.processIdentifier === 'number') {
    args.push(targetFocus.bundleIdentifier ?? '');
    args.push(String(targetFocus.processIdentifier ?? ''));
  }

  const result = await runHelperJson<{ ok: boolean }>(args);
  return result.ok;
}

export async function startFnListener(
  onEvent: (event: HotkeyEvent) => void,
  onError?: (message: string) => void,
): Promise<boolean> {
  const helperReady = await ensureNativeHelper();
  if (!helperReady || listenerProcess) {
    return helperReady;
  }

  const child = spawn(getHelperBinaryPath(), ['listen'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  listenerProcess = child;
  const stdoutInterface = readline.createInterface({ input: child.stdout });

  stdoutInterface.on('line', (line) => {
    if (!line.trim()) {
      return;
    }

    try {
      const message = JSON.parse(line) as {
        type?: string;
        message?: string;
        terminalCommandMode?: boolean;
      };

      if (message.type === 'fnDown') {
        onEvent({ type: 'down', terminalCommandMode: Boolean(message.terminalCommandMode) });
      }

      if (message.type === 'fnUp') {
        onEvent({ type: 'up', terminalCommandMode: Boolean(message.terminalCommandMode) });
      }

      if (message.type === 'modifierChanged') {
        onEvent({
          type: 'modifierChanged',
          terminalCommandMode: Boolean(message.terminalCommandMode),
        });
      }

      if (message.type === 'error') {
        onError?.(message.message ?? 'The native helper could not watch the Fn key.');
      }
    } catch {
      // Ignore malformed lines from the native helper.
    }
  });

  child.stderr.on('data', (chunk) => {
    const message = chunk.toString().trim();
    if (message) {
      onError?.(message);
    }
  });

  child.on('close', () => {
    stdoutInterface.close();
    listenerProcess = null;
  });

  return true;
}

export function isFnListenerRunning(): boolean {
  return listenerProcess !== null;
}

export function stopFnListener(): void {
  listenerProcess?.kill();
  listenerProcess = null;
}
