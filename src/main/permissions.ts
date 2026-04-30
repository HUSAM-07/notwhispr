import { shell, systemPreferences } from 'electron';

import type { PermissionsState } from '../shared/types';
import { getNativePermissionState, requestNativePermissions } from './native-helper';

const MICROPHONE_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone';
const ACCESSIBILITY_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';
const INPUT_MONITORING_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent';

async function openSettingsPane(targetUrl: string): Promise<void> {
  try {
    await shell.openExternal(targetUrl);
  } catch {
    // Ignore settings URL failures and still return the current permission state.
  }
}

export async function getPermissionState(): Promise<PermissionsState> {
  const nativePermissions = await getNativePermissionState();
  const microphone = systemPreferences.getMediaAccessStatus('microphone');

  return {
    microphone:
      microphone === 'granted' ||
      microphone === 'denied' ||
      microphone === 'restricted' ||
      microphone === 'not-determined'
        ? microphone
        : 'unknown',
    accessibility: nativePermissions.accessibility,
    inputMonitoring: nativePermissions.inputMonitoring,
    postEvents: nativePermissions.postEvents,
  };
}

async function waitForMicrophoneAccess(attempts = 5): Promise<PermissionsState> {
  for (let i = 0; i < attempts; i++) {
    const state = await getPermissionState();
    if (state.microphone === 'granted') return state;
    await new Promise((r) => setTimeout(r, 500));
  }
  return getPermissionState();
}

export async function requestMicrophoneAccess(): Promise<PermissionsState> {
  let granted = false;

  try {
    granted = await systemPreferences.askForMediaAccess('microphone');
  } catch {
    // Electron throws when the permission cannot be requested from the current context.
  }

  if (granted) {
    return waitForMicrophoneAccess();
  }

  const nextState = await getPermissionState();
  if (nextState.microphone !== 'granted') {
    await openSettingsPane(MICROPHONE_SETTINGS_URL);
    return waitForMicrophoneAccess();
  }

  return nextState;
}

async function waitForSystemAccess(attempts = 10): Promise<PermissionsState> {
  for (let i = 0; i < attempts; i++) {
    const state = await getPermissionState();
    if (state.accessibility && state.inputMonitoring && state.postEvents) return state;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return getPermissionState();
}

export async function requestSystemAccess(): Promise<PermissionsState> {
  await requestNativePermissions();
  const nextState = await getPermissionState();

  if (!nextState.accessibility || !nextState.postEvents) {
    await openSettingsPane(ACCESSIBILITY_SETTINGS_URL);
  } else if (!nextState.inputMonitoring) {
    await openSettingsPane(INPUT_MONITORING_SETTINGS_URL);
  }

  return waitForSystemAccess();
}
