import { type ComponentType, useEffect, useMemo, useRef, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Home01Icon, PaintBrush01Icon, CubeIcon, Settings01Icon } from '@hugeicons/core-free-icons';

import { AudioRecorder } from './audio-recorder';
import logoUrl from './logo.png';
import coverUrl from '../../assets/cover.png';
import type {
  AppStatus,
  BootstrapState,
  EnhancementLevel,
  FocusInfo,
  HotkeyEvent,
  MindmapDraft,
  MindmapNode,
  MindmapPreviewRequest,
  OpenRouterModelInfo,
  StyleMode,
} from '../shared/types';
import { RECOMMENDED_TEXT_MODEL, RECOMMENDED_WHISPER_LABEL } from '../shared/recommendations';

const OVERLAY_VIEW = window.location.hash === '#overlay';
const MINDMAP_VIEW = window.location.hash === '#mindmap';

type Page = 'home' | 'style' | 'models' | 'preferences';

interface LevelOption {
  value: EnhancementLevel;
  label: string;
  caption: string;
  detail: string;
  intensity: number;
}

interface StyleOption {
  value: StyleMode;
  label: string;
  description: string;
  levels: Record<EnhancementLevel, { example: string }>;
}

const LEVEL_OPTIONS: LevelOption[] = [
  { value: 'none', label: 'No filter', caption: 'Minimal touch — fix typos only.', detail: 'Corrects spelling and punctuation. Your exact words, cleaned up.', intensity: 1 },
  { value: 'soft', label: 'Soft', caption: 'Light grammar and clarity polish.', detail: 'Fixes filler words and grammar while keeping your natural voice.', intensity: 2 },
  { value: 'medium', label: 'Medium', caption: 'Rewrite for natural, clear prose.', detail: 'Restructures awkward phrasing into clean, readable text.', intensity: 3 },
  { value: 'high', label: 'High', caption: 'Professional polish and expansion.', detail: 'Turns rough dictation into polished, professional writing.', intensity: 4 },
];

const STYLE_OPTIONS: StyleOption[] = [
  {
    value: 'conversation',
    label: 'Conversation',
    description: 'Natural conversation style. Perfect for messages, notes, and everyday writing.',
    levels: {
      none: { example: 'I went to the store and bought some stuff for the project.' },
      soft: { example: 'I went to the store and picked up some things for the project.' },
      medium: { example: 'I stopped by the store and picked up supplies for the project.' },
      high: { example: 'I visited the store to procure the necessary supplies for our project.' },
    },
  },
  {
    value: 'vibe-coding',
    label: 'Vibe Coding',
    description: 'Developer mode. Translates your speech into proper software engineering language.',
    levels: {
      none: { example: 'We need to refactor the auth thing because it\'s hitting the database too much.' },
      soft: { example: 'We need to refactor the auth module because it\'s making too many database calls.' },
      medium: { example: 'We need to refactor the authentication service to reduce excessive database queries.' },
      high: { example: 'The authentication service requires refactoring to optimize query patterns and eliminate redundant database round-trips.' },
    },
  },
];

const GRID_COLS = 7;
const GRID_ROWS = 3;
const GRID_TOTAL = GRID_COLS * GRID_ROWS;
const OPTION_MULTI_TAP_MS = 340;
const OPTION_LATCH_TAP_COUNT = 3;
const FN_TAP_MAX_MS = 260;
type OverlayDictationModes = { terminal: boolean; diagram: boolean };

const TERMINAL_APP_NAMES = new Set([
  'terminal',
  'iterm',
  'iterm2',
  'warp',
  'wezterm',
  'alacritty',
  'kitty',
  'ghostty',
  'hyper',
  'tabby',
]);

const TERMINAL_BUNDLE_FRAGMENTS = [
  'com.apple.terminal',
  'com.googlecode.iterm2',
  'dev.warp',
  'com.github.wez.wezterm',
  'org.alacritty',
  'net.kovidgoyal.kitty',
  'com.mitchellh.ghostty',
  'co.zeit.hyper',
  'org.tabby',
];

function isLikelyTerminalFocus(focusInfo: FocusInfo | null | undefined): boolean {
  if (!focusInfo) return false;
  const appName = focusInfo.appName?.toLowerCase().trim();
  if (appName && TERMINAL_APP_NAMES.has(appName)) return true;
  const bundle = focusInfo.bundleIdentifier?.toLowerCase() ?? '';
  return TERMINAL_BUNDLE_FRAGMENTS.some((fragment) => bundle.includes(fragment));
}

function createOverlayModes(terminal = false, diagram = false): OverlayDictationModes {
  return { terminal, diagram };
}

function formatBytes(size: number): string {
  if (size <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let current = size;
  let unitIndex = 0;
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }
  return `${current.toFixed(current >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function CheckIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/* ────────────────────────────────────────────────
   App
   ──────────────────────────────────────────────── */

export function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);
  const [status, setStatus] = useState<AppStatus>({
    phase: 'idle',
    title: 'Ready',
    detail: 'Hold Option to dictate. Release Option to paste.',
  });
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [overlayModes, setOverlayModes] = useState<OverlayDictationModes>(() => createOverlayModes());
  const recorderRef = useRef<AudioRecorder | null>(null);
  const recordingRef = useRef(false);
  const processingRef = useRef(false);
  const bootstrapRef = useRef<BootstrapState | null>(null);
  const targetFocusRef = useRef<FocusInfo | null>(null);
  const forceTerminalCommandModeRef = useRef(false);
  const disableTerminalCommandModeRef = useRef(false);
  const forceDiagramModeRef = useRef(false);
  const latchedRecordingRef = useRef(false);
  const fnDownAtRef = useRef(0);
  const optionTapCountRef = useRef(0);
  const pendingTapStopRef = useRef<number | null>(null);

  useEffect(() => { bootstrapRef.current = bootstrap; }, [bootstrap]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const next = await window.openWhisp.bootstrap();
      if (!mounted) return;
      setBootstrap(next);
      setStatus(next.status);
    };
    void load();
    const stopStatus = window.openWhisp.onStatus((s) => { if (mounted) setStatus(s); });
    const stopHotkey = OVERLAY_VIEW
      ? window.openWhisp.onHotkey((e) => {
          if (e.type === 'down') void handleHotkeyDown(e);
          if (e.type === 'modifierChanged') handleHotkeyModifierChanged(e);
          if (e.type === 'up') void handleHotkeyUp();
        })
      : () => undefined;
    return () => { mounted = false; stopStatus(); stopHotkey(); };
  }, []);

  useEffect(() => {
    if (OVERLAY_VIEW) {
      const recorder = new AudioRecorder();
      recorder.onLevel = (level) => setAudioLevel(level);
      recorderRef.current = recorder;
    }
  }, []);

  useEffect(() => {
    if (status.phase !== 'listening') {
      setAudioLevel(0);
      if (!processingRef.current) setOverlayModes(createOverlayModes());
    }
  }, [status.phase]);

  const refreshBootstrap = async () => {
    const next = await window.openWhisp.bootstrap();
    bootstrapRef.current = next;
    setBootstrap(next);
    setStatus(next.status);
    return next;
  };

  const pushStatus = (s: AppStatus) => { setStatus(s); window.openWhisp.pushStatus(s); };
  const setLocalStatus = (s: AppStatus) => setStatus(s);

  const clearPendingTapStop = () => {
    if (pendingTapStopRef.current) {
      window.clearTimeout(pendingTapStopRef.current);
      pendingTapStopRef.current = null;
    }
  };

  const runAction = async (label: string, action: () => Promise<BootstrapState>) => {
    try {
      setBusyAction(label);
      const next = await action();
      bootstrapRef.current = next;
      setBootstrap(next);
      setStatus(next.status);
    } catch (error) {
      pushStatus({
        phase: 'error',
        title: 'Action failed',
        detail: error instanceof Error ? error.message : 'Could not complete this action.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const finishRecording = async () => {
    clearPendingTapStop();
    if (!recordingRef.current || processingRef.current) return;
    optionTapCountRef.current = 0;
    latchedRecordingRef.current = false;
    recordingRef.current = false;
    processingRef.current = true;
    try {
      const wavBase64 = await recorderRef.current?.stop();
      if (!wavBase64) throw new Error('No recording was captured.');
      const result = await window.openWhisp.processAudio({
        wavBase64,
        targetFocus: targetFocusRef.current ?? undefined,
        forceTerminalCommandMode: forceTerminalCommandModeRef.current,
        disableTerminalCommandMode: disableTerminalCommandModeRef.current,
        forceDiagramMode: forceDiagramModeRef.current,
      });
      if (!result.rawText && !result.finalText && !result.pasted) {
        return;
      }
      const diagramDraft = result.diagramDraft ?? result.mindmapDraft;
      if (diagramDraft) {
        await window.openWhisp.openMindmapPreview({
          draft: diagramDraft,
          targetFocus: targetFocusRef.current ?? undefined,
        });
        pushStatus({
          phase: 'done',
          title: 'Diagram preview opened',
          detail: 'Edit the diagram, then copy or save the PNG when it looks right.',
          preview: diagramDraft.title,
          rawText: result.rawText,
        });
        return;
      }
      pushStatus({
        phase: 'done',
        title: result.pasted ? 'Pasted' : 'Copied',
        detail: result.pasted ? 'Refined text pasted into the active app.' : 'Refined text is on the clipboard.',
        preview: result.finalText,
        rawText: result.rawText,
      });
    } catch (error) {
      pushStatus({ phase: 'error', title: 'Dictation failed', detail: error instanceof Error ? error.message : 'Could not finish dictation.' });
    } finally {
      targetFocusRef.current = null;
      forceTerminalCommandModeRef.current = false;
      disableTerminalCommandModeRef.current = false;
      forceDiagramModeRef.current = false;
      latchedRecordingRef.current = false;
      optionTapCountRef.current = 0;
      setOverlayModes(createOverlayModes());
      processingRef.current = false;
    }
  };

  const cancelRecording = async () => {
    clearPendingTapStop();
    if (!recordingRef.current || processingRef.current) return;

    recordingRef.current = false;
    latchedRecordingRef.current = false;
    optionTapCountRef.current = 0;
    processingRef.current = true;

    try {
      await recorderRef.current?.stop();
    } catch {
      // Cancelling intentionally discards the current clip.
    } finally {
      targetFocusRef.current = null;
      forceTerminalCommandModeRef.current = false;
      disableTerminalCommandModeRef.current = false;
      forceDiagramModeRef.current = false;
      setOverlayModes(createOverlayModes());
      setAudioLevel(0);
      processingRef.current = false;
      pushStatus({
        phase: 'idle',
        title: 'Ready',
        detail: 'Hold Option to dictate. Release Option to paste.',
      });
    }
  };

  const handleHotkeyDown = async (event: HotkeyEvent) => {
    fnDownAtRef.current = Date.now();
    if (pendingTapStopRef.current && recordingRef.current && !processingRef.current) {
      clearPendingTapStop();
      if (optionTapCountRef.current >= OPTION_LATCH_TAP_COUNT - 1) {
        optionTapCountRef.current = 0;
        latchedRecordingRef.current = true;
        pushStatus({
          phase: 'listening',
          title: overlayModes.diagram
            ? 'Diagram mode locked'
            : overlayModes.terminal
              ? 'Command mode locked'
              : 'Listening locked',
          detail: 'Tap Option again to stop recording.',
        });
      }
      return;
    }
    if (latchedRecordingRef.current && recordingRef.current && !processingRef.current) {
      await finishRecording();
      return;
    }

    const current = await refreshBootstrap();
    if (recordingRef.current || processingRef.current) return;
    forceDiagramModeRef.current = Boolean(event.diagramMode);
    forceTerminalCommandModeRef.current = !forceDiagramModeRef.current && Boolean(event.terminalCommandMode);
    disableTerminalCommandModeRef.current = false;
    setOverlayModes(createOverlayModes(forceTerminalCommandModeRef.current, forceDiagramModeRef.current));

    if (current.permissions.microphone !== 'granted') {
      pushStatus({ phase: 'error', title: 'Microphone needed', detail: 'Grant microphone access in setup.' });
      await window.openWhisp.showMainWindow();
      return;
    }
    if (!current.permissions.inputMonitoring || !current.permissions.postEvents || !current.permissions.accessibility) {
      pushStatus({ phase: 'error', title: 'System access needed', detail: 'Enable permissions in setup.' });
      await window.openWhisp.showMainWindow();
      return;
    }
    if (!current.speechModelReady) {
      pushStatus({ phase: 'error', title: 'Speech model unavailable', detail: 'Download the speech model first.' });
      await window.openWhisp.showMainWindow();
      return;
    }
    if (!current.textProviderReady) {
      const detail = current.settings.textProvider === 'openrouter'
        ? 'Add your OpenRouter API key in Models.'
        : 'Start Ollama and install the rewrite model.';
      pushStatus({ phase: 'error', title: 'Text model unavailable', detail });
      await window.openWhisp.showMainWindow();
      return;
    }

    try {
      targetFocusRef.current = await window.openWhisp.captureFocusTarget();
      const autoTerminalMode =
        current.settings.terminalCommandMode &&
        !forceDiagramModeRef.current &&
        (forceTerminalCommandModeRef.current || isLikelyTerminalFocus(targetFocusRef.current));
      forceTerminalCommandModeRef.current = autoTerminalMode;
      disableTerminalCommandModeRef.current = false;
      setOverlayModes(createOverlayModes(autoTerminalMode, forceDiagramModeRef.current));
      recordingRef.current = true;
      await recorderRef.current?.start();
      pushStatus({
        phase: 'listening',
        title: forceDiagramModeRef.current ? 'Diagram enabled' : autoTerminalMode ? 'Listening for command' : 'Listening',
        detail: forceDiagramModeRef.current
          ? 'This recording will become an editable diagram.'
          : autoTerminalMode
            ? 'Speak a terminal command while holding Option + Control.'
            : 'Speak while holding Option.',
      });
    } catch (error) {
      recordingRef.current = false;
      pushStatus({ phase: 'error', title: 'Microphone error', detail: error instanceof Error ? error.message : 'Microphone could not start.' });
    }
  };

  const handleHotkeyModifierChanged = (event: HotkeyEvent) => {
    if (!recordingRef.current || processingRef.current) return;
    if (!event.terminalCommandMode && !event.diagramMode) return;

    if (event.diagramMode) {
      forceDiagramModeRef.current = true;
      forceTerminalCommandModeRef.current = false;
      disableTerminalCommandModeRef.current = true;
      setOverlayModes(createOverlayModes(false, true));
      setLocalStatus({
        phase: 'listening',
        title: 'Diagram enabled',
        detail: 'This recording will become an editable diagram.',
      });
      return;
    }

    forceTerminalCommandModeRef.current = true;
    forceDiagramModeRef.current = false;
    disableTerminalCommandModeRef.current = false;
    setOverlayModes(createOverlayModes(true, false));
    setLocalStatus({
      phase: 'listening',
      title: 'Listening for command',
      detail: 'Speak a terminal command while holding Option + Control.',
    });
  };

  const toggleOverlayMode = (mode: keyof OverlayDictationModes) => {
    if (!recordingRef.current || processingRef.current) return;
    if (mode === 'diagram') {
      const nextDiagram = !forceDiagramModeRef.current;
      forceDiagramModeRef.current = nextDiagram;
      if (nextDiagram) {
        forceTerminalCommandModeRef.current = false;
        disableTerminalCommandModeRef.current = true;
      }
      setOverlayModes(createOverlayModes(false, nextDiagram));
      setLocalStatus({
        phase: 'listening',
        title: nextDiagram ? 'Diagram enabled' : 'Listening',
        detail: nextDiagram
          ? 'This recording will become an editable diagram.'
          : 'Speak while holding Option.',
      });
      return;
    }

    if (mode === 'terminal') {
      const nextTerminal = !forceTerminalCommandModeRef.current;
      forceTerminalCommandModeRef.current = nextTerminal;
      if (nextTerminal) {
        forceDiagramModeRef.current = false;
      }
      disableTerminalCommandModeRef.current = !nextTerminal;
      setOverlayModes(createOverlayModes(nextTerminal, false));
      setLocalStatus({
        phase: 'listening',
        title: nextTerminal ? 'Terminal enabled' : 'Listening',
        detail: nextTerminal
          ? 'This recording will become one shell line.'
          : 'Speak while holding Option.',
      });
    }
  };

  const handleHotkeyUp = async () => {
    if (!recordingRef.current || processingRef.current) return;
    if (latchedRecordingRef.current) return;

    const pressDuration = Date.now() - fnDownAtRef.current;
    if (pressDuration <= FN_TAP_MAX_MS) {
      optionTapCountRef.current = Math.min(OPTION_LATCH_TAP_COUNT - 1, optionTapCountRef.current + 1);
      clearPendingTapStop();
      pendingTapStopRef.current = window.setTimeout(() => {
        pendingTapStopRef.current = null;
        optionTapCountRef.current = 0;
        void finishRecording();
      }, OPTION_MULTI_TAP_MS);
      return;
    }

    optionTapCountRef.current = 0;
    await finishRecording();
  };

  if (MINDMAP_VIEW) return <MindmapPreviewWindow />;
  if (OVERLAY_VIEW) {
    return (
      <OverlayBar
        status={status}
        audioLevel={audioLevel}
        modes={overlayModes}
        onToggleMode={toggleOverlayMode}
        onCancelRecording={() => void cancelRecording()}
      />
    );
  }
  if (!bootstrap) {
    return <main className="app-shell loading-shell"><div className="loading-spinner" /><span className="loading-text">Loading Openwhisp</span></main>;
  }
  if (!bootstrap.settings.setupComplete) {
    return <SetupWizard bootstrap={bootstrap} busyAction={busyAction} onAction={runAction} onRefresh={refreshBootstrap} onComplete={() => void runAction('setup', () => window.openWhisp.updateSettings({ setupComplete: true }))} />;
  }

  return <MainView bootstrap={bootstrap} status={status} busyAction={busyAction} onAction={runAction} />;
}

/* ────────────────────────────────────────────────
   Setup Wizard (unchanged structure)
   ──────────────────────────────────────────────── */

function SetupWizard({ bootstrap, busyAction, onAction, onRefresh, onComplete }: {
  bootstrap: BootstrapState; busyAction: string | null;
  onAction: (l: string, a: () => Promise<BootstrapState>) => Promise<void>;
  onRefresh: () => Promise<BootstrapState>; onComplete: () => void;
}) {
  const steps = ['welcome', 'engine', 'models', 'permissions', 'ready'] as const;
  type Step = (typeof steps)[number];
  const [step, setStep] = useState<Step>('welcome');
  const idx = steps.indexOf(step);
  const next = () => { if (idx + 1 < steps.length) setStep(steps[idx + 1]); };
  const back = () => { if (idx > 0) setStep(steps[idx - 1]); };

  return (
    <main className="setup-shell">
      <div className="drag-region" />
      <div className="setup-progress">
        {steps.map((s, i) => (
          <div key={s} className={`setup-dot${i <= idx ? ' setup-dot-active' : ''}${i === idx ? ' setup-dot-current' : ''}`} />
        ))}
      </div>
      <div className="setup-body" key={step}>
        {step === 'welcome' && (
          <div className="setup-step setup-step-center">
            <div className="fn-key"><span>⌥</span></div>
            <h1 className="setup-title serif">Welcome to Openwhisp</h1>
            <p className="setup-desc">Local dictation with Whisper. Pick a local or cloud model to polish your text.</p>
            <div className="setup-nav"><div /><button className="btn btn-primary" onClick={next}>Get Started</button></div>
          </div>
        )}
        {step === 'engine' && <EngineStep bootstrap={bootstrap} busyAction={busyAction} onAction={onAction} onRefresh={onRefresh} onNext={next} onBack={back} />}
        {step === 'models' && <ModelsStep bootstrap={bootstrap} busyAction={busyAction} onAction={onAction} onNext={next} onBack={back} />}
        {step === 'permissions' && <PermissionsStep bootstrap={bootstrap} busyAction={busyAction} onAction={onAction} onNext={next} onBack={back} />}
        {step === 'ready' && (
          <div className="setup-step setup-step-center">
            <div className="ready-icon"><CheckIcon size={32} /></div>
            <h1 className="setup-title serif">You're All Set</h1>
            <p className="setup-desc">Hold Option to dictate. Release it and Openwhisp handles the rest.</p>
            <div className="setup-nav"><button className="btn btn-ghost" onClick={back}>Back</button><button className="btn btn-primary" onClick={onComplete}>Start Dictating</button></div>
          </div>
        )}
      </div>
    </main>
  );
}

function EngineStep({ bootstrap, busyAction, onAction, onRefresh, onNext, onBack }: {
  bootstrap: BootstrapState;
  busyAction: string | null;
  onAction: (l: string, a: () => Promise<BootstrapState>) => Promise<void>;
  onRefresh: () => Promise<BootstrapState>;
  onNext: () => void;
  onBack: () => void;
}) {
  const provider = bootstrap.settings.textProvider;
  const [checking, setChecking] = useState(false);
  const retry = async () => { setChecking(true); await onRefresh(); setChecking(false); };

  const setProvider = (next: 'ollama' | 'openrouter') => {
    if (next === provider) return;
    void onAction('engine', () => window.openWhisp.updateSettings({ textProvider: next }));
  };

  const canContinue = provider === 'ollama'
    ? bootstrap.ollamaReachable
    : Boolean(bootstrap.settings.openrouterApiKey);

  return (
    <div className="setup-step">
      <h1 className="setup-title serif">Choose Text Engine</h1>
      <p className="setup-desc">Pick how Openwhisp polishes your dictation. You can switch later.</p>

      <div className="engine-grid">
        <button
          className={`engine-card${provider === 'ollama' ? ' engine-card-active' : ''}`}
          onClick={() => setProvider('ollama')}
        >
          <strong className="serif">Local (Ollama)</strong>
          <p>Runs entirely on your Mac. Free, private, needs ~10 GB disk for the model.</p>
          {provider === 'ollama' && <span className="badge badge-ready">Selected</span>}
        </button>
        <button
          className={`engine-card${provider === 'openrouter' ? ' engine-card-active' : ''}`}
          onClick={() => setProvider('openrouter')}
        >
          <strong className="serif">Cloud (OpenRouter)</strong>
          <p>Bring your own API key. No local download. Pennies per dictation.</p>
          {provider === 'openrouter' && <span className="badge badge-ready">Selected</span>}
        </button>
      </div>

      {provider === 'ollama' && (
        <div className="s-card">
          <div className="s-card-row">
            <div className="s-card-info"><strong>Ollama Server</strong><span>{bootstrap.settings.ollamaBaseUrl}</span></div>
            {bootstrap.ollamaReachable ? <span className="badge badge-ready"><CheckIcon size={12} /> Connected</span> : <span className="badge badge-pending">Not running</span>}
          </div>
          {!bootstrap.ollamaReachable && (
            <div className="s-card-bottom">
              <p className="s-card-hint">Install and start Ollama to continue.</p>
              <div className="btn-group">
                <button className="btn btn-secondary" onClick={() => void window.openWhisp.openExternal('https://ollama.com/download/mac')}>Install Ollama</button>
                <button className="btn btn-secondary" onClick={() => void retry()} disabled={checking}>{checking ? 'Checking...' : 'Retry'}</button>
              </div>
            </div>
          )}
          {bootstrap.ollamaReachable && bootstrap.ollamaModels.length > 0 && <div className="s-card-meta">{bootstrap.ollamaModels.length} model{bootstrap.ollamaModels.length !== 1 ? 's' : ''} available</div>}
        </div>
      )}

      {provider === 'openrouter' && (
        <OpenRouterKeyCard bootstrap={bootstrap} busyAction={busyAction} onAction={onAction} />
      )}

      <div className="setup-nav">
        <button className="btn btn-ghost" onClick={onBack}>Back</button>
        <button className="btn btn-primary" onClick={onNext} disabled={!canContinue}>Continue</button>
      </div>
    </div>
  );
}

function OpenRouterKeyCard({ bootstrap, busyAction, onAction }: {
  bootstrap: BootstrapState;
  busyAction: string | null;
  onAction: (l: string, a: () => Promise<BootstrapState>) => Promise<void>;
}) {
  const [draft, setDraft] = useState(bootstrap.settings.openrouterApiKey);
  const [reveal, setReveal] = useState(false);
  useEffect(() => { setDraft(bootstrap.settings.openrouterApiKey); }, [bootstrap.settings.openrouterApiKey]);

  const persist = async () => {
    if (draft === bootstrap.settings.openrouterApiKey) return;
    await onAction('orKey', () => window.openWhisp.updateSettings({ openrouterApiKey: draft }));
  };

  return (
    <div className="s-card">
      <div className="s-card-info" style={{ marginBottom: 8 }}>
        <strong>OpenRouter API key</strong>
        <span>Stored on this Mac only. Get one at openrouter.ai/keys.</span>
      </div>
      <div className="url-field">
        <input
          className="setting-input"
          type={reveal ? 'text' : 'password'}
          placeholder="sk-or-v1-…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void persist()}
          disabled={busyAction === 'orKey'}
        />
        <button className="btn btn-link" onClick={() => setReveal((p) => !p)}>{reveal ? 'Hide' : 'Show'}</button>
        <button className="btn btn-link" onClick={() => void window.openWhisp.openExternal('https://openrouter.ai/keys')}>Get key</button>
      </div>
    </div>
  );
}

function ModelsStep({ bootstrap, busyAction, onAction, onNext, onBack }: { bootstrap: BootstrapState; busyAction: string | null; onAction: (l: string, a: () => Promise<BootstrapState>) => Promise<void>; onNext: () => void; onBack: () => void }) {
  const provider = bootstrap.settings.textProvider;
  return (
    <div className="setup-step">
      <h1 className="setup-title serif">Choose Models</h1>
      <p className="setup-desc">Whisper handles speech locally. Pick a text model that matches your engine.</p>
      <div className="s-card">
        <div className="s-card-label">Speech to Text</div>
        <div className="s-card-row">
          <div className="s-card-info"><strong>{RECOMMENDED_WHISPER_LABEL}</strong><span>Local speech recognition</span></div>
          {bootstrap.speechModelReady ? <span className="badge badge-ready"><CheckIcon size={12} /> Ready</span> : <button className="btn btn-sm btn-primary" disabled={busyAction === 'speech'} onClick={() => void onAction('speech', () => window.openWhisp.prepareSpeechModel())}>{busyAction === 'speech' ? 'Downloading...' : 'Download'}</button>}
        </div>
      </div>

      {provider === 'ollama'
        ? <OllamaTextSetup bootstrap={bootstrap} busyAction={busyAction} onAction={onAction} />
        : <OpenRouterTextSetup bootstrap={bootstrap} onAction={onAction} />}

      <div className="setup-nav">
        <button className="btn btn-ghost" onClick={onBack}>Back</button>
        <button className="btn btn-primary" onClick={onNext} disabled={!bootstrap.speechModelReady || !bootstrap.textProviderReady}>Continue</button>
      </div>
    </div>
  );
}

function OllamaTextSetup({ bootstrap, busyAction, onAction }: {
  bootstrap: BootstrapState;
  busyAction: string | null;
  onAction: (l: string, a: () => Promise<BootstrapState>) => Promise<void>;
}) {
  const installed = bootstrap.ollamaModels;
  const selected = bootstrap.settings.textModel;
  const selectedInstalled = installed.some((m) => m.name === selected);
  const recommendedInstalled = installed.some((m) => m.name === RECOMMENDED_TEXT_MODEL);

  return (
    <div className="s-card">
      <div className="s-card-label">Text Enhancement (Local)</div>
      <div className="setting-row">
        <label className="setting-label" htmlFor="setup-ollama-model">Rewrite model</label>
        <select
          id="setup-ollama-model"
          className="setting-select"
          value={selected}
          onChange={(e) => void onAction('settings', () => window.openWhisp.updateSettings({ textModel: e.target.value }))}
        >
          {installed.length === 0
            ? <option value={selected}>{selected} (not installed)</option>
            : installed.map((m) => <option key={m.name} value={m.name}>{m.name} ({formatBytes(m.size)})</option>)}
        </select>
      </div>
      {!selectedInstalled && (
        <p className="s-card-hint">
          {installed.length === 0
            ? 'No Ollama models found. Pull one with `ollama pull` or click below for the recommended model.'
            : 'Selected model isn\'t installed. Pick an installed model above or pull it via Ollama.'}
        </p>
      )}
      {!recommendedInstalled && bootstrap.ollamaReachable && (
        <button
          className="btn btn-sm btn-primary"
          style={{ marginTop: 10 }}
          disabled={busyAction === 'model'}
          onClick={() => void onAction('model', () => window.openWhisp.pullRecommendedModel())}
        >
          {busyAction === 'model' ? 'Downloading...' : `Download ${RECOMMENDED_TEXT_MODEL}`}
        </button>
      )}
    </div>
  );
}

function OpenRouterTextSetup({ bootstrap, onAction }: {
  bootstrap: BootstrapState;
  onAction: (l: string, a: () => Promise<BootstrapState>) => Promise<void>;
}) {
  const [models, setModels] = useState<OpenRouterModelInfo[]>([]);
  const selected = bootstrap.settings.openrouterTextModel;

  useEffect(() => {
    let cancelled = false;
    void window.openWhisp.listOpenRouterTextModels().then((list) => {
      if (!cancelled) setModels(list);
    });
    return () => { cancelled = true; };
  }, []);

  const selectableModels = models.length > 0
    ? models
    : ([{ id: selected, name: selected } as OpenRouterModelInfo]);
  const activeModel = selectableModels.find((m) => m.id === selected) ?? selectableModels[0];

  return (
    <div className="s-card">
      <div className="s-card-label">Text Enhancement (OpenRouter)</div>
      <div className="setting-row">
        <label className="setting-label" htmlFor="setup-or-model">Rewrite model</label>
        <select
          id="setup-or-model"
          className="setting-select"
          value={selected}
          onChange={(e) => void onAction('settings', () => window.openWhisp.updateSettings({ openrouterTextModel: e.target.value }))}
        >
          {selectableModels.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </div>
      {activeModel?.description && <p className="s-card-hint">{activeModel.description}</p>}
      {!bootstrap.settings.openrouterApiKey && (
        <p className="s-card-hint">Add your OpenRouter API key in the previous step to enable rewriting.</p>
      )}
    </div>
  );
}

function PermissionsStep({ bootstrap, busyAction, onAction, onNext, onBack }: { bootstrap: BootstrapState; busyAction: string | null; onAction: (l: string, a: () => Promise<BootstrapState>) => Promise<void>; onNext: () => void; onBack: () => void }) {
  const micOk = bootstrap.permissions.microphone === 'granted';
  const sysOk = bootstrap.permissions.accessibility && bootstrap.permissions.inputMonitoring && bootstrap.permissions.postEvents;
  return (
    <div className="setup-step">
      <h1 className="setup-title serif">Allow Access</h1>
      <p className="setup-desc">Openwhisp needs permissions to listen, transcribe, and paste.</p>
      <div className="s-card">
        <div className="s-card-row">
          <div className="s-card-info"><strong>Microphone</strong><span>Captures your voice</span></div>
          {micOk ? <span className="badge badge-ready"><CheckIcon size={12} /> Granted</span> : <button className="btn btn-sm btn-primary" disabled={busyAction === 'mic'} onClick={() => void onAction('mic', () => window.openWhisp.requestMicrophoneAccess())}>{busyAction === 'mic' ? 'Requesting...' : 'Allow'}</button>}
        </div>
        <div className="s-card-divider" />
        <div className="s-card-row">
          <div className="s-card-info"><strong>System Access</strong><span>Option key and auto-paste</span></div>
          {sysOk ? <span className="badge badge-ready"><CheckIcon size={12} /> Granted</span> : <button className="btn btn-sm btn-primary" disabled={busyAction === 'system'} onClick={() => void onAction('system', () => window.openWhisp.requestSystemAccess())}>{busyAction === 'system' ? 'Opening...' : 'Allow'}</button>}
        </div>
      </div>
      {!sysOk && <p className="setup-hint">macOS will prompt you in System Settings. You may need to restart the app.</p>}
      <div className="setup-nav"><button className="btn btn-ghost" onClick={onBack}>Back</button><button className="btn btn-primary" onClick={onNext} disabled={!micOk || !sysOk}>Continue</button></div>
    </div>
  );
}

/* ────────────────────────────────────────────────
   Main View – sidebar + pages
   ──────────────────────────────────────────────── */

function MainView({ bootstrap, status, busyAction, onAction }: {
  bootstrap: BootstrapState; status: AppStatus; busyAction: string | null;
  onAction: (l: string, a: () => Promise<BootstrapState>) => Promise<void>;
}) {
  const [page, setPage] = useState<Page>('home');

  return (
    <div className="layout">
      <div className="drag-region" />

      <aside className="sidebar">
        <div className="sidebar-brand">
          <img src={logoUrl} alt="" className="sidebar-logo" />
          <h1 className="serif">Openwhisp</h1>
        </div>
        <nav className="sidebar-nav">
          <button className={`nav-item${page === 'home' ? ' nav-item-active' : ''}`} onClick={() => setPage('home')}>
            <HugeiconsIcon icon={Home01Icon} size={18} strokeWidth={2} /> Home
          </button>
          <button className={`nav-item${page === 'style' ? ' nav-item-active' : ''}`} onClick={() => setPage('style')}>
            <HugeiconsIcon icon={PaintBrush01Icon} size={18} strokeWidth={2} /> Style
          </button>
          <button className={`nav-item${page === 'models' ? ' nav-item-active' : ''}`} onClick={() => setPage('models')}>
            <HugeiconsIcon icon={CubeIcon} size={18} strokeWidth={2} /> Models
          </button>
          <button className={`nav-item${page === 'preferences' ? ' nav-item-active' : ''}`} onClick={() => setPage('preferences')}>
            <HugeiconsIcon icon={Settings01Icon} size={18} strokeWidth={2} /> Preferences
          </button>
        </nav>
        <div className="sidebar-footer">
          <button className="btn btn-link btn-muted" onClick={() => void onAction('setup', () => window.openWhisp.updateSettings({ setupComplete: false }))}>Reset Setup</button>
          <div className="sidebar-credits">
            <button className="credit-link" onClick={() => void window.openWhisp.openExternal('https://x.com/GiusMarci')}>@GiusMarci</button>
            <span className="credit-dot" />
            <button className="credit-link" onClick={() => void window.openWhisp.openExternal('https://raelume.ai')}>raelume.ai</button>
          </div>
        </div>
      </aside>

      <main className="content">
        {page === 'home' && <HomePage status={status} bootstrap={bootstrap} setPage={setPage} />}
        {page === 'style' && <StylePage bootstrap={bootstrap} onAction={onAction} />}
        {page === 'models' && <ModelsPage bootstrap={bootstrap} busyAction={busyAction} onAction={onAction} />}
        {page === 'preferences' && <PreferencesPage bootstrap={bootstrap} onAction={onAction} />}
      </main>
    </div>
  );
}

/* ── Home ─────────────────────────────────────── */

function HomePage({ status, bootstrap, setPage }: { status: AppStatus; bootstrap: BootstrapState; setPage: (p: Page) => void }) {
  const level = LEVEL_OPTIONS.find((l) => l.value === bootstrap.settings.enhancementLevel);
  const style = STYLE_OPTIONS.find((s) => s.value === bootstrap.settings.styleMode);
  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title serif">Welcome back</h2>
      </div>

      <div className="banner" style={{ backgroundImage: `url(${coverUrl})` }}>
        <div className="banner-content">
          <h3 className="serif">Press Option. Speak. Done.</h3>
          <p>Your voice, transcribed and polished entirely on your Mac. No cloud. No latency.</p>
        </div>
      </div>

      <div className="home-grid">
        <div className="card status-card">
          <div className="status-row">
            <div className={`status-dot status-${status.phase}`} />
            <div className="status-info">
              <strong>{status.title}</strong>
              <span>{status.detail}</span>
            </div>
          </div>
          {status.preview && <pre className="status-preview">{status.preview}</pre>}
          {status.imageUrl && (
            <a className="status-image-link" href={status.imageUrl} onClick={(e) => { e.preventDefault(); void window.openWhisp.openExternal(status.imageUrl!); }}>
              <img src={status.imageUrl} alt="Generated" className="status-image" />
              <span>Open generated image</span>
            </a>
          )}
        </div>

        <div className="home-stats">
          <button className="stat-card" onClick={() => setPage('style')}>
            <span className="stat-value">{style?.label ?? 'Conversation'}</span>
            <span className="stat-label">{level?.label ?? 'Medium'}</span>
          </button>
          <button className="stat-card" onClick={() => setPage('models')}>
            <span className="stat-value stat-value-sm">{bootstrap.settings.textModel.split(':')[0]}</span>
            <span className="stat-label">Text model</span>
          </button>
          <button className="stat-card" onClick={() => setPage('models')}>
            <span className={`stat-value ${bootstrap.settings.imageAgent.enabled ? 'stat-ok' : 'stat-off'}`}>{bootstrap.settings.imageAgent.enabled ? 'On' : 'Off'}</span>
            <span className="stat-label">Image AI</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Style ─────────────────────────────────────── */

function StylePage({ bootstrap, onAction }: { bootstrap: BootstrapState; onAction: (l: string, a: () => Promise<BootstrapState>) => Promise<void> }) {
  const activeStyle = STYLE_OPTIONS.find((s) => s.value === bootstrap.settings.styleMode) ?? STYLE_OPTIONS[0];

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title serif">Style</h2>
        <p className="page-desc">Choose your dictation style and enhancement level.</p>
      </div>

      <div className="style-tabs">
        {STYLE_OPTIONS.map((s) => (
          <button
            key={s.value}
            className={`style-tab${bootstrap.settings.styleMode === s.value ? ' style-tab-active' : ''}`}
            onClick={() => void onAction('settings', () => window.openWhisp.updateSettings({ styleMode: s.value }))}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className={`style-banner${activeStyle.value === 'vibe-coding' ? ' style-banner-dev' : ''}`}>
        <p>{activeStyle.description}</p>
      </div>

      <div className="enhance-grid">
        {LEVEL_OPTIONS.map((level) => {
          const active = bootstrap.settings.enhancementLevel === level.value;
          const example = activeStyle.levels[level.value].example;
          return (
            <button
              key={level.value}
              className={`enhance-card${active ? ' enhance-card-active' : ''}`}
              onClick={() => void onAction('settings', () => window.openWhisp.updateSettings({ enhancementLevel: level.value }))}
            >
              <div className="enhance-card-top">
                <strong className="serif">{level.label}</strong>
                {active && <span className="badge badge-ready">Active</span>}
              </div>
              <p className="enhance-caption">{level.caption}</p>
              <p className="enhance-example">"{example}"</p>
              <div className="intensity-bar">
                {[1, 2, 3, 4].map((i) => (
                  <span key={i} className={`intensity-dot${i <= level.intensity ? ' intensity-dot-on' : ''}`} />
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Models ───────────────────────────────────── */

function ModelsPage({ bootstrap, busyAction, onAction }: { bootstrap: BootstrapState; busyAction: string | null; onAction: (l: string, a: () => Promise<BootstrapState>) => Promise<void> }) {
  const [ollamaUrl, setOllamaUrl] = useState(bootstrap.settings.ollamaBaseUrl);
  useEffect(() => { setOllamaUrl(bootstrap.settings.ollamaBaseUrl); }, [bootstrap.settings.ollamaBaseUrl]);

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title serif">Models</h2>
        <p className="page-desc">Configure the AI models that power your dictation.</p>
      </div>

      <div className="card">
        <div className="card-head"><h3>Speech to Text</h3></div>
        <div className="model-row">
          <div className="model-info">
            <strong>{bootstrap.settings.whisperLabel}</strong>
            <span>Local Whisper model for speech recognition</span>
          </div>
          {bootstrap.speechModelReady
            ? <span className="badge badge-ready"><CheckIcon size={12} /> Ready</span>
            : <button className="btn btn-sm btn-primary" disabled={busyAction === 'speech'} onClick={() => void onAction('speech', () => window.openWhisp.prepareSpeechModel())}>{busyAction === 'speech' ? 'Downloading...' : 'Download'}</button>
          }
        </div>
      </div>

      <TextEnhancementCard bootstrap={bootstrap} busyAction={busyAction} onAction={onAction} />

      {bootstrap.settings.textProvider === 'ollama' && (
        <div className="card">
          <div className="card-head"><h3>Ollama Connection</h3></div>
          <div className="setting-row">
            <label className="setting-label" htmlFor="ollama-url">Server URL</label>
            <div className="url-field">
              <input id="ollama-url" className="setting-input" value={ollamaUrl} onChange={(e) => setOllamaUrl(e.target.value)} onBlur={() => void onAction('settings', () => window.openWhisp.updateSettings({ ollamaBaseUrl: ollamaUrl }))} />
              <span className={`url-badge${bootstrap.ollamaReachable ? ' url-badge-ok' : ' url-badge-off'}`}>{bootstrap.ollamaReachable ? 'Connected' : 'Offline'}</span>
            </div>
          </div>
        </div>
      )}

      <ImageAgentCard bootstrap={bootstrap} onAction={onAction} />
      <ImageStorageCard bootstrap={bootstrap} onAction={onAction} />
    </div>
  );
}

/* ── Text Enhancement (provider-aware) ───────── */

function TextEnhancementCard({ bootstrap, busyAction, onAction }: {
  bootstrap: BootstrapState;
  busyAction: string | null;
  onAction: (l: string, a: () => Promise<BootstrapState>) => Promise<void>;
}) {
  const provider = bootstrap.settings.textProvider;
  const [orModels, setOrModels] = useState<OpenRouterModelInfo[]>([]);

  useEffect(() => {
    if (provider !== 'openrouter') return;
    let cancelled = false;
    void window.openWhisp.listOpenRouterTextModels().then((list) => { if (!cancelled) setOrModels(list); });
    return () => { cancelled = true; };
  }, [provider]);

  const setProvider = (next: 'ollama' | 'openrouter') => {
    if (next === provider) return;
    void onAction('settings', () => window.openWhisp.updateSettings({ textProvider: next }));
  };

  return (
    <div className="card">
      <div className="card-head">
        <h3>Text Enhancement</h3>
        {provider === 'ollama' && <button className="btn btn-link" onClick={() => void onAction('refresh', () => window.openWhisp.refreshOllama())}>Refresh</button>}
      </div>

      <div className="style-tabs" style={{ marginBottom: 16 }}>
        <button className={`style-tab${provider === 'ollama' ? ' style-tab-active' : ''}`} onClick={() => setProvider('ollama')}>Local (Ollama)</button>
        <button className={`style-tab${provider === 'openrouter' ? ' style-tab-active' : ''}`} onClick={() => setProvider('openrouter')}>Cloud (OpenRouter)</button>
      </div>

      {provider === 'ollama' ? (
        <>
          <div className="setting-row">
            <label className="setting-label" htmlFor="model-select">Rewrite model</label>
            <select id="model-select" className="setting-select" value={bootstrap.settings.textModel} onChange={(e) => void onAction('settings', () => window.openWhisp.updateSettings({ textModel: e.target.value }))}>
              {bootstrap.ollamaModels.length === 0
                ? <option value={bootstrap.settings.textModel}>{bootstrap.settings.textModel}</option>
                : bootstrap.ollamaModels.map((m) => <option key={m.name} value={m.name}>{m.name} ({formatBytes(m.size)})</option>)}
            </select>
          </div>
          {!bootstrap.recommendedModelInstalled && bootstrap.ollamaReachable && (
            <button className="btn btn-sm btn-primary" style={{ marginTop: 10 }} disabled={busyAction === 'model'} onClick={() => void onAction('model', () => window.openWhisp.pullRecommendedModel())}>
              {busyAction === 'model' ? 'Downloading...' : `Download ${RECOMMENDED_TEXT_MODEL}`}
            </button>
          )}
        </>
      ) : (
        <OpenRouterTextSection bootstrap={bootstrap} models={orModels} onAction={onAction} />
      )}
    </div>
  );
}

function OpenRouterTextSection({ bootstrap, models, onAction }: {
  bootstrap: BootstrapState;
  models: OpenRouterModelInfo[];
  onAction: (l: string, a: () => Promise<BootstrapState>) => Promise<void>;
}) {
  const [keyDraft, setKeyDraft] = useState(bootstrap.settings.openrouterApiKey);
  const [reveal, setReveal] = useState(false);
  useEffect(() => { setKeyDraft(bootstrap.settings.openrouterApiKey); }, [bootstrap.settings.openrouterApiKey]);

  const persistKey = async () => {
    if (keyDraft === bootstrap.settings.openrouterApiKey) return;
    await onAction('orKey', () => window.openWhisp.updateSettings({ openrouterApiKey: keyDraft }));
  };

  const selected = bootstrap.settings.openrouterTextModel;
  const selectableModels = models.length > 0
    ? models
    : ([{ id: selected, name: selected } as OpenRouterModelInfo]);
  const activeModel = selectableModels.find((m) => m.id === selected) ?? selectableModels[0];

  return (
    <>
      <div className="setting-row">
        <label className="setting-label" htmlFor="or-text-key">API key</label>
        <div className="url-field">
          <input id="or-text-key" className="setting-input" type={reveal ? 'text' : 'password'} placeholder="sk-or-v1-…" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} onBlur={() => void persistKey()} />
          <button className="btn btn-link" onClick={() => setReveal((p) => !p)}>{reveal ? 'Hide' : 'Show'}</button>
          <button className="btn btn-link" onClick={() => void window.openWhisp.openExternal('https://openrouter.ai/keys')}>Get key</button>
        </div>
      </div>
      <div className="setting-row">
        <label className="setting-label" htmlFor="or-text-model">Rewrite model</label>
        <select id="or-text-model" className="setting-select" value={selected} onChange={(e) => void onAction('settings', () => window.openWhisp.updateSettings({ openrouterTextModel: e.target.value }))}>
          {selectableModels.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>
      {activeModel?.description && <p className="s-card-hint">{activeModel.description}</p>}
    </>
  );
}

/* ── Image AI ─────────────────────────────────── */

function ImageAgentCard({ bootstrap, onAction }: {
  bootstrap: BootstrapState;
  onAction: (l: string, a: () => Promise<BootstrapState>) => Promise<void>;
}) {
  const settings = bootstrap.settings.imageAgent;
  const [apiKeyDraft, setApiKeyDraft] = useState(bootstrap.settings.openrouterApiKey);
  const [revealKey, setRevealKey] = useState(false);
  const [models, setModels] = useState<OpenRouterModelInfo[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => { setApiKeyDraft(bootstrap.settings.openrouterApiKey); }, [bootstrap.settings.openrouterApiKey]);

  const persistKey = async (value: string) => {
    if (value === bootstrap.settings.openrouterApiKey) return;
    await onAction('imageKey', () => window.openWhisp.updateSettings({ openrouterApiKey: value }));
  };

  const refreshModels = async () => {
    if (!apiKeyDraft) {
      setStatusMessage('Add your OpenRouter API key first.');
      return;
    }
    setLoadingModels(true);
    setStatusMessage(null);
    try {
      const list = await window.openWhisp.listImageModels(apiKeyDraft);
      setModels(list);
      if (list.length === 0) {
        setStatusMessage('No image-output models returned for this account.');
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to load image models.');
    } finally {
      setLoadingModels(false);
    }
  };

  const selectableModels = models.length > 0
    ? models
    : ([{ id: settings.imageModel, name: settings.imageModel } as OpenRouterModelInfo]);

  return (
    <div className="card">
      <div className="card-head">
        <h3>Image AI (OpenRouter)</h3>
        <button className="btn btn-link" onClick={() => void window.openWhisp.openExternal('https://openrouter.ai/keys')}>Get a key</button>
      </div>
      <p className="page-desc" style={{ marginTop: 0 }}>
        Bring your own OpenRouter key. When the agent hears you ask for an image,
        it generates one and pastes the public URL.
      </p>

      <ToggleRow
        title="Enable image agent"
        description={bootstrap.imageStorageReady ? 'Detect image requests during dictation and generate them automatically.' : 'Configure Supabase storage in .env before enabling.'}
        checked={settings.enabled}
        onChange={(v) => void onAction('imageAgent', () => window.openWhisp.updateSettings({ imageAgent: { enabled: v } }))}
      />

      <div className="setting-row">
        <label className="setting-label" htmlFor="openrouter-key">OpenRouter API key</label>
        <div className="url-field">
          <input
            id="openrouter-key"
            className="setting-input"
            type={revealKey ? 'text' : 'password'}
            value={apiKeyDraft}
            placeholder="sk-or-v1-…"
            onChange={(e) => setApiKeyDraft(e.target.value)}
            onBlur={() => void persistKey(apiKeyDraft)}
          />
          <button className="btn btn-link" onClick={() => setRevealKey((prev) => !prev)}>{revealKey ? 'Hide' : 'Show'}</button>
        </div>
      </div>

      <div className="setting-row">
        <label className="setting-label" htmlFor="image-model-select">Image model</label>
        <div className="url-field">
          <select
            id="image-model-select"
            className="setting-select"
            value={settings.imageModel}
            onChange={(e) => void onAction('imageAgent', () => window.openWhisp.updateSettings({ imageAgent: { imageModel: e.target.value } }))}
          >
            {selectableModels.map((m) => (
              <option key={m.id} value={m.id}>{m.name}{m.imagePrice ? ` — $${m.imagePrice}/image` : ''}</option>
            ))}
          </select>
          <button className="btn btn-link" disabled={loadingModels} onClick={() => void refreshModels()}>
            {loadingModels ? 'Loading…' : 'Refresh models'}
          </button>
        </div>
      </div>

      <div className="setting-row">
        <span className="setting-label">Storage</span>
        <span className={`url-badge${bootstrap.imageStorageReady ? ' url-badge-ok' : ' url-badge-off'}`}>
          {bootstrap.imageStorageReady ? 'Supabase ready' : 'Not configured'}
        </span>
      </div>

      {statusMessage && <p className="setup-hint" style={{ marginTop: 8 }}>{statusMessage}</p>}
    </div>
  );
}

/* ── Preferences ──────────────────────────────── */

function PreferencesPage({ bootstrap, onAction }: { bootstrap: BootstrapState; onAction: (l: string, a: () => Promise<BootstrapState>) => Promise<void> }) {
  const p = bootstrap.permissions;
  const micOk = p.microphone === 'granted';
  const sysOk = p.accessibility && p.inputMonitoring && p.postEvents;

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title serif">Preferences</h2>
        <p className="page-desc">Customize how Openwhisp works.</p>
      </div>

      <div className="card">
        <div className="card-head"><h3>Behavior</h3></div>
        <ToggleRow title="Auto-paste" description="Paste into the active app after rewriting" checked={bootstrap.settings.autoPaste} onChange={(v) => void onAction('settings', () => window.openWhisp.updateSettings({ autoPaste: v }))} />
        <ToggleRow title="Terminal command mode" description="When a terminal app is focused, turn speech into one shell command and paste it without running it" checked={bootstrap.settings.terminalCommandMode} onChange={(v) => void onAction('settings', () => window.openWhisp.updateSettings({ terminalCommandMode: v }))} />
        <ToggleRow title="Show overlay" description="Show the dictation badge on screen" checked={bootstrap.settings.showOverlay} onChange={(v) => void onAction('settings', () => window.openWhisp.updateSettings({ showOverlay: v }))} />
        <ToggleRow title="Launch at login" description="Start Openwhisp when you log in" checked={bootstrap.settings.launchAtLogin} onChange={(v) => void onAction('settings', () => window.openWhisp.updateSettings({ launchAtLogin: v }))} />
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Permissions</h3>
          <button className="btn btn-link" onClick={() => void onAction('refresh', () => window.openWhisp.bootstrap())}>Refresh</button>
        </div>
        <div className="perm-grid">
          <div className="perm-row">
            <span className="perm-name">Microphone</span>
            <span className={`perm-status${micOk ? ' perm-ok' : ' perm-missing'}`}>{micOk ? 'Granted' : 'Not granted'}</span>
            {!micOk && <button className="btn btn-sm btn-primary" onClick={() => void onAction('mic', () => window.openWhisp.requestMicrophoneAccess())}>Allow</button>}
          </div>
          <div className="perm-row">
            <span className="perm-name">Accessibility</span>
            <span className={`perm-status${p.accessibility ? ' perm-ok' : ' perm-missing'}`}>{p.accessibility ? 'Granted' : 'Not granted'}</span>
          </div>
          <div className="perm-row">
            <span className="perm-name">Input Monitoring</span>
            <span className={`perm-status${p.inputMonitoring ? ' perm-ok' : ' perm-missing'}`}>{p.inputMonitoring ? 'Granted' : 'Not granted'}</span>
          </div>
          <div className="perm-row">
            <span className="perm-name">Paste Events</span>
            <span className={`perm-status${p.postEvents ? ' perm-ok' : ' perm-missing'}`}>{p.postEvents ? 'Granted' : 'Not granted'}</span>
          </div>
          {!sysOk && <button className="btn btn-sm btn-secondary" style={{ marginTop: 8 }} onClick={() => void onAction('system', () => window.openWhisp.requestSystemAccess())}>Grant Permissions</button>}
          <button className="btn btn-link btn-muted" style={{ marginTop: 8 }} onClick={() => void window.openWhisp.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy')}>Manage in System Settings</button>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Storage</h3>
          <div className="btn-group-compact">
            <button className="btn btn-link" onClick={() => void onAction('storage', () => window.openWhisp.chooseStorage())}>Change</button>
            <button className="btn btn-link" onClick={() => void window.openWhisp.revealStorage()}>Open</button>
          </div>
        </div>
        <span className="storage-path">{bootstrap.settings.storageDirectory}</span>
      </div>
    </div>
  );
}

/* ── Image Storage (BYO Supabase) ────────────── */

function ImageStorageCard({ bootstrap, onAction }: {
  bootstrap: BootstrapState;
  onAction: (l: string, a: () => Promise<BootstrapState>) => Promise<void>;
}) {
  const storage = bootstrap.settings.imageStorage;
  const [url, setUrl] = useState(storage.url);
  const [publishable, setPublishable] = useState(storage.publishableKey);
  const [secret, setSecret] = useState(storage.secretKey);
  const [bucket, setBucket] = useState(storage.bucket || 'openflow');
  const [revealSecret, setRevealSecret] = useState(false);

  useEffect(() => { setUrl(storage.url); }, [storage.url]);
  useEffect(() => { setPublishable(storage.publishableKey); }, [storage.publishableKey]);
  useEffect(() => { setSecret(storage.secretKey); }, [storage.secretKey]);
  useEffect(() => { setBucket(storage.bucket || 'openflow'); }, [storage.bucket]);

  const persist = async (patch: Partial<typeof storage>) => {
    await onAction('imageStorage', () => window.openWhisp.updateSettings({ imageStorage: patch }));
  };

  return (
    <div className="card">
      <div className="card-head">
        <h3>Image Storage</h3>
        <span className={`url-badge${bootstrap.imageStorageReady ? ' url-badge-ok' : ' url-badge-off'}`}>
          {bootstrap.imageStorageReady ? 'Ready' : 'Not configured'}
        </span>
      </div>
      <p className="page-desc" style={{ marginTop: 0 }}>
        Generated images upload here. Bring your own Supabase project — the bucket must exist and be public.
      </p>

      <div className="setting-row">
        <label className="setting-label" htmlFor="storage-url">Project URL</label>
        <input
          id="storage-url"
          className="setting-input"
          placeholder="https://xxxx.supabase.co"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => { if (url !== storage.url) void persist({ url }); }}
        />
      </div>

      <div className="setting-row">
        <label className="setting-label" htmlFor="storage-bucket">Bucket name</label>
        <input
          id="storage-bucket"
          className="setting-input"
          placeholder="openflow"
          value={bucket}
          onChange={(e) => setBucket(e.target.value)}
          onBlur={() => { if (bucket !== storage.bucket) void persist({ bucket }); }}
        />
      </div>

      <div className="setting-row">
        <label className="setting-label" htmlFor="storage-pub">Publishable key</label>
        <input
          id="storage-pub"
          className="setting-input"
          placeholder="sb_publishable_…"
          value={publishable}
          onChange={(e) => setPublishable(e.target.value)}
          onBlur={() => { if (publishable !== storage.publishableKey) void persist({ publishableKey: publishable }); }}
        />
      </div>

      <div className="setting-row">
        <label className="setting-label" htmlFor="storage-secret">Secret key</label>
        <div className="url-field">
          <input
            id="storage-secret"
            className="setting-input"
            type={revealSecret ? 'text' : 'password'}
            placeholder="sb_secret_…"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            onBlur={() => { if (secret !== storage.secretKey) void persist({ secretKey: secret }); }}
          />
          <button className="btn btn-link" onClick={() => setRevealSecret((p) => !p)}>{revealSecret ? 'Hide' : 'Show'}</button>
          <button className="btn btn-link" onClick={() => void window.openWhisp.openExternal('https://supabase.com/dashboard')}>Dashboard</button>
        </div>
      </div>

      <p className="s-card-hint" style={{ marginTop: 8 }}>
        The secret key is used for uploads only and stays on this Mac. Use a Supabase project you own.
      </p>
    </div>
  );
}

/* ── Toggle Row ───────────────────────────────── */

function ToggleRow({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="toggle-row">
      <div className="toggle-info"><strong>{title}</strong><span>{description}</span></div>
      <label className="switch"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><span className="switch-slider" /></label>
    </div>
  );
}

/* ── Mindmap Preview ───────────────────────────── */

type ExcalidrawApi = {
  getSceneElements: () => readonly unknown[];
  getAppState: () => Record<string, unknown>;
  getFiles: () => Record<string, unknown>;
  scrollToContent?: (elements?: readonly unknown[]) => void;
  updateScene?: (scene: Record<string, unknown>) => void;
};

type ExcalidrawModule = {
  Excalidraw: ComponentType<Record<string, unknown>>;
  convertToExcalidrawElements: (elements: never) => readonly unknown[];
  exportToBlob: (options: Record<string, unknown>) => Promise<Blob>;
};

function MindmapPreviewWindow() {
  const [preview, setPreview] = useState<MindmapPreviewRequest | null>(null);
  const [excalidrawApi, setExcalidrawApi] = useState<ExcalidrawApi | null>(null);
  const [excalidrawModule, setExcalidrawModule] = useState<ExcalidrawModule | null>(null);
  const [busyAction, setBusyAction] = useState<'copy' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void import('@excalidraw/excalidraw').then((module) => {
      if (mounted) setExcalidrawModule(module as unknown as ExcalidrawModule);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    void window.openWhisp.getMindmapPreview().then((request) => {
      if (mounted) setPreview(request);
    });
    const stop = window.openWhisp.onMindmapPreview((request) => {
      if (mounted) setPreview(request);
    });
    return () => {
      mounted = false;
      stop();
    };
  }, []);

  const elements = useMemo(
    () => preview && excalidrawModule
      ? createMindmapElements(preview.draft, excalidrawModule.convertToExcalidrawElements)
      : [],
    [excalidrawModule, preview],
  );

  useEffect(() => {
    if (!excalidrawApi || elements.length === 0) return;
    excalidrawApi.updateScene?.({
      elements,
      appState: {
        viewBackgroundColor: '#fffaf0',
        gridModeEnabled: false,
        zenModeEnabled: false,
        scrollX: 80,
        scrollY: 80,
        zoom: { value: 0.8 },
      },
    });
    window.setTimeout(() => excalidrawApi.scrollToContent?.(elements), 250);
  }, [excalidrawApi, elements]);

  const exportPngDataUrl = async (): Promise<string> => {
    if (!excalidrawApi || !excalidrawModule) throw new Error('Mindmap editor is still loading.');
    const blob = await excalidrawModule.exportToBlob({
      elements: excalidrawApi.getSceneElements() as never,
      appState: {
        ...excalidrawApi.getAppState(),
        exportWithDarkMode: false,
        viewBackgroundColor: '#fffaf0',
      },
      files: excalidrawApi.getFiles() as never,
      mimeType: 'image/png',
      quality: 0.92,
    });
    return blobToDataUrl(blob);
  };

  const copyPng = async () => {
    if (!excalidrawApi || !preview) return;
    setBusyAction('copy');
    setError(null);

    try {
      const dataUrl = await exportPngDataUrl();
      await window.openWhisp.copyMindmapPng({
        dataUrl,
        title: preview.draft.title,
      });
      setBusyAction(null);
    } catch (err) {
      setBusyAction(null);
      setError(err instanceof Error ? err.message : 'Could not export the mindmap.');
    }
  };

  const savePng = async () => {
    if (!excalidrawApi || !preview) return;
    setBusyAction('save');
    setError(null);

    try {
      const dataUrl = await exportPngDataUrl();
      await window.openWhisp.saveMindmapPng({
        dataUrl,
        title: preview.draft.title,
      });
      setBusyAction(null);
    } catch (err) {
      setBusyAction(null);
      setError(err instanceof Error ? err.message : 'Could not save the mindmap.');
    }
  };

  const cancel = () => {
    void window.openWhisp.cancelMindmapPreview();
  };

  if (!preview) {
    return (
      <main className="mindmap-shell">
        <div className="mindmap-empty">No pending diagram.</div>
      </main>
    );
  }

  if (!excalidrawModule) {
    return (
      <main className="mindmap-shell">
        <div className="mindmap-empty">Loading diagram editor…</div>
      </main>
    );
  }

  const ExcalidrawEditor = excalidrawModule.Excalidraw;
  const busy = busyAction !== null;

  return (
    <main className="mindmap-shell">
      <header className="mindmap-toolbar">
        <div>
          <p className="mindmap-eyebrow">Editable diagram preview</p>
          <h1 className="mindmap-title">{preview.draft.title}</h1>
          <p className="mindmap-meta">{preview.draft.nodes.length} nodes · {preview.draft.edges.length} links</p>
        </div>
        <div className="mindmap-actions">
          {error && <span className="mindmap-error">{error}</span>}
          <button className="btn btn-ghost" onClick={cancel} disabled={busy}>Cancel</button>
          <button className="btn btn-ghost" onClick={() => void savePng()} disabled={busy || !excalidrawApi}>
            {busyAction === 'save' ? 'Saving…' : 'Save PNG'}
          </button>
          <button className="btn btn-primary" onClick={() => void copyPng()} disabled={busy || !excalidrawApi}>
            {busyAction === 'copy' ? 'Copying…' : 'Copy PNG'}
          </button>
        </div>
      </header>
      <section className="mindmap-canvas">
        <ExcalidrawEditor
          key={`${preview.draft.title}:${preview.draft.layout}:${preview.draft.nodes.length}:${preview.draft.edges.length}:${preview.draft.sourceText}`}
          initialData={{
            elements,
            appState: {
              viewBackgroundColor: '#fffaf0',
              gridModeEnabled: false,
              zenModeEnabled: false,
              scrollX: 80,
              scrollY: 80,
              zoom: { value: 0.8 },
            },
            scrollToContent: true,
          }}
          excalidrawAPI={(api: unknown) => setExcalidrawApi(api as ExcalidrawApi)}
        />
      </section>
    </main>
  );
}

/** Top-left position and size for one mindmap node (avoids overlap and text clipping). */
type MindmapLayoutCell = { x: number; y: number; width: number; height: number };

const LAYOUT_MARGIN = 120;
const LAYOUT_ANCHOR_X = 280;
const LAYOUT_ANCHOR_Y = 320;
const EDGE_ENDPOINT_GAP = 18;
const DECISION_EDGE_ENDPOINT_GAP = 5;
const EDGE_LABEL_MAX_LEN = 26;

function estimateTextLineCount(text: string, width: number, fontSize: number): number {
  const innerWidth = Math.max(40, width);
  const approxCharsPerLine = Math.max(8, Math.floor(innerWidth / (fontSize * 0.52)));
  return text.split('\n').reduce((acc, segment) => {
    const trimmed = segment.trim();
    if (trimmed.length === 0) return acc + 1;
    return acc + Math.max(1, Math.ceil(trimmed.length / approxCharsPerLine));
  }, 0);
}

function wrapTextToWidth(text: string, width: number, fontSize: number): string {
  const approxCharsPerLine = Math.max(8, Math.floor(Math.max(40, width) / (fontSize * 0.55)));
  return text
    .split('\n')
    .map((segment) => {
      const words = segment.trim().split(/\s+/).filter(Boolean);
      if (words.length === 0) return '';
      const lines: string[] = [];
      let current = '';
      for (const word of words) {
        if (!current) {
          current = word;
          continue;
        }
        const next = `${current} ${word}`;
        if (next.length <= approxCharsPerLine) {
          current = next;
        } else {
          lines.push(current);
          current = word;
        }
      }
      if (current) lines.push(current);
      return lines.join('\n');
    })
    .join('\n');
}

function estimateNodeBox(node: MindmapNode, role: 'root' | 'branch' | 'leaf'): { width: number; height: number } {
  const text = getDiagramNodeText(node);
  const longestWord = text.split(/\s+/).reduce((max, word) => Math.max(max, word.length), 0);
  const width = Math.min(520, Math.max(role === 'root' ? 300 : 252, longestWord * 13 + 56, text.length > 28 ? 340 : 0));
  const fontSize = role === 'root' ? 22 : 18;
  const innerWidth = Math.max(40, width - 36);
  const lineCount = estimateTextLineCount(text, innerWidth, fontSize);
  const lineHeight = fontSize * 1.35;
  const padY = 32;
  const minH = node.detail ? 96 : 84;
  const height = Math.min(380, Math.max(minH, padY + lineCount * lineHeight));
  return { width, height };
}

function normalizeMindmapLayout(layout: Map<string, MindmapLayoutCell>): Map<string, MindmapLayoutCell> {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const cell of layout.values()) {
    minX = Math.min(minX, cell.x);
    minY = Math.min(minY, cell.y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return layout;
  const dx = minX < LAYOUT_MARGIN ? LAYOUT_MARGIN - minX : 0;
  const dy = minY < LAYOUT_MARGIN ? LAYOUT_MARGIN - minY : 0;
  if (dx === 0 && dy === 0) return layout;
  const next = new Map<string, MindmapLayoutCell>();
  for (const [id, cell] of layout) {
    next.set(id, { ...cell, x: cell.x + dx, y: cell.y + dy });
  }
  return next;
}

function formatMindmapEdgeLabel(
  text: string | undefined,
  totalEdges: number,
  outgoingFromSameNode: number,
  layoutKind: MindmapDraft['layout'],
): string | undefined {
  if (!text?.trim()) return undefined;
  if (layoutKind !== 'decision' && outgoingFromSameNode > 1) return undefined;
  const t = text.replace(/\s+/g, ' ').trim();
  if (layoutKind === 'decision' && t.length > 14) return undefined;
  if (layoutKind !== 'decision' && totalEdges > 10) return undefined;
  if (t.length <= EDGE_LABEL_MAX_LEN) return t;
  return `${t.slice(0, EDGE_LABEL_MAX_LEN - 1)}…`;
}

type LinearSkeleton = { x: number; y: number; points: [number, number][] };

function absolutePointsToLinearElement(abs: [number, number][]): { x: number; y: number; points: [number, number][] } {
  const [originX, originY] = abs[0] ?? [0, 0];
  const points = abs.map((p) => [p[0] - originX, p[1] - originY] as [number, number]);
  return { x: originX, y: originY, points };
}

function getBoxConnectorPoint(
  cell: MindmapLayoutCell,
  toward: MindmapLayoutCell,
  gap: number,
): [number, number] {
  const cx = cell.x + cell.width / 2;
  const cy = cell.y + cell.height / 2;
  const tx = toward.x + toward.width / 2;
  const ty = toward.y + toward.height / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  const distance = Math.hypot(dx, dy) || 1;
  const ux = dx / distance;
  const uy = dy / distance;
  const scaleX = ux === 0 ? Number.POSITIVE_INFINITY : (cell.width / 2) / Math.abs(ux);
  const scaleY = uy === 0 ? Number.POSITIVE_INFINITY : (cell.height / 2) / Math.abs(uy);
  const scale = Math.min(scaleX, scaleY);
  return [cx + ux * (scale + gap), cy + uy * (scale + gap)];
}

function buildDirectArrowSkeleton(
  from: MindmapLayoutCell,
  to: MindmapLayoutCell,
): LinearSkeleton {
  const p0 = getBoxConnectorPoint(from, to, EDGE_ENDPOINT_GAP);
  const p1 = getBoxConnectorPoint(to, from, EDGE_ENDPOINT_GAP);
  return absolutePointsToLinearElement([p0, p1]);
}

function buildWaypointArrowSkeleton(
  from: MindmapLayoutCell,
  to: MindmapLayoutCell,
  waypoints: [number, number][],
): LinearSkeleton {
  const p0 = getBoxConnectorPoint(from, to, EDGE_ENDPOINT_GAP);
  const p1 = getBoxConnectorPoint(to, from, EDGE_ENDPOINT_GAP);
  return absolutePointsToLinearElement([p0, ...waypoints, p1]);
}

function buildDecisionArrowSkeleton(
  from: MindmapLayoutCell,
  to: MindmapLayoutCell,
): LinearSkeleton {
  const p0 = getBoxConnectorPoint(from, to, DECISION_EDGE_ENDPOINT_GAP);
  const p1 = getBoxConnectorPoint(to, from, DECISION_EDGE_ENDPOINT_GAP);
  return absolutePointsToLinearElement([p0, p1]);
}

function buildTimelineAxisSkeleton(layout: Map<string, MindmapLayoutCell>): LinearSkeleton | null {
  const cells = [...layout.values()];
  if (cells.length < 2) return null;
  const minX = Math.min(...cells.map((cell) => cell.x));
  const maxX = Math.max(...cells.map((cell) => cell.x + cell.width));
  const centerY =
    cells.reduce((sum, cell) => sum + cell.y + cell.height / 2, 0) / cells.length;
  return absolutePointsToLinearElement([
    [minX - 70, centerY],
    [maxX + 70, centerY],
  ]);
}

function shouldUsePlainLine(layoutKind: MindmapDraft['layout']): boolean {
  return layoutKind === 'mindmap' || layoutKind === 'comparison';
}

const DECISION_PALETTE = [
  { fill: '#fff3bf', stroke: '#f59f00' },
  { fill: '#dbeafe', stroke: '#2563eb' },
  { fill: '#f3e8ff', stroke: '#9333ea' },
  { fill: '#dcfce7', stroke: '#16a34a' },
  { fill: '#ffedd5', stroke: '#f97316' },
  { fill: '#cffafe', stroke: '#0891b2' },
];

function getDiagramNodeText(node: MindmapNode): string {
  const lines = [node.label];
  if (node.subtext) lines.push(node.subtext);
  if (node.details?.length) lines.push(...node.details.map((detail) => `- ${detail}`));
  else if (node.detail) lines.push(node.detail);
  return lines.filter(Boolean).join('\n');
}

function getPaletteColor(draft: MindmapDraft | undefined, key: string | undefined) {
  if (!key) return null;
  return draft?.palette?.[key] ?? null;
}

function getDiagramNodeColors(
  node: MindmapNode,
  layoutKind: MindmapDraft['layout'],
  isRoot: boolean,
  draft?: MindmapDraft,
  depth = 0,
  outgoingCount = 0,
) {
  const explicit = getPaletteColor(draft, node.color);
  if (explicit) return explicit;

  const text = `${node.label} ${node.detail ?? ''}`.toLowerCase();
  if (layoutKind === 'decision') {
    if (/\bred\b/.test(text)) return { fill: '#ffe3e3', stroke: '#fa5252' };
    if (/\bblue\b/.test(text)) return { fill: '#dbeafe', stroke: '#2563eb' };
    if (/\b(suppress|skip|failed|bounced|blocked|stop)\b/.test(text)) {
      return { fill: '#ffe3e3', stroke: '#fa5252' };
    }
    if (/\b(send|delivered|success|attempt|alternate|money|time|superpower|teleportation)\b/.test(text)) {
      return { fill: '#d3f9d8', stroke: '#22c55e' };
    }
    if (/\b(wait|pause|cooldown|pending)\b/.test(text)) {
      return { fill: '#fff3bf', stroke: '#f59f00' };
    }
    return outgoingCount > 0
      ? DECISION_PALETTE[depth % DECISION_PALETTE.length]
      : DECISION_PALETTE[(depth + 3) % DECISION_PALETTE.length];
  }

  return {
    fill: isRoot ? '#fff4e6' : '#e8f4fc',
    stroke: isRoot ? '#d9480f' : '#1864ab',
  };
}

function isDecisionNodeLabel(label: string): boolean {
  return (
    /\?/.test(label) ||
    /\b(if|check|gate|condition|decision|branch)\b/i.test(label) ||
    /^(is|are|do|does|did|can|should|has|have|was|were)\b/i.test(label.trim())
  );
}

function createMindmapElements(
  draft: MindmapDraft,
  convertToExcalidrawElements: (elements: never) => readonly unknown[],
): readonly unknown[] {
  const layoutKind = draft.layout ?? 'mindmap';
  const layout = layoutMindmapNodes(draft);
  const shapeElements: unknown[] = [];
  const decorationSkeletons: unknown[] = [];
  const rootId = draft.nodes[0]?.id;
  const edgeCount = draft.edges.length;
  const depths = computeDepthsFromRoot(draft);

  if (layoutKind === 'timeline') {
    const axis = buildTimelineAxisSkeleton(layout);
    if (axis) {
      decorationSkeletons.push({
        type: 'line' as const,
        x: axis.x,
        y: axis.y,
        points: axis.points,
        strokeColor: '#868e96',
        strokeWidth: 2,
        strokeStyle: 'dashed' as const,
        roughness: 0.7,
      });
    }
  }

  const outgoingCountByFrom = new Map<string, number>();
  for (const e of draft.edges) {
    outgoingCountByFrom.set(e.from, (outgoingCountByFrom.get(e.from) ?? 0) + 1);
  }

  const connectorSkeletons = draft.edges
    .map((edge) => {
      const from = layout.get(edge.from);
      const to = layout.get(edge.to);
      if (!from || !to) return null;

      const outboundCount = outgoingCountByFrom.get(edge.from) ?? 1;
      const explicitWaypoints = edge.waypoints?.map((point) => [point.x, point.y] as [number, number]);
      const shouldUseWaypoints = explicitWaypoints?.length && layoutKind !== 'decision';
      const { x, y, points } = shouldUseWaypoints
        ? buildWaypointArrowSkeleton(from, to, explicitWaypoints)
        : layoutKind === 'decision' || edge.routing === 'orthogonal'
          ? buildDecisionArrowSkeleton(from, to)
          : buildDirectArrowSkeleton(from, to);
      const labelText = formatMindmapEdgeLabel(edge.label, edgeCount, outboundCount, layoutKind);
      const isLine = shouldUsePlainLine(layoutKind);
      const edgePalette = getPaletteColor(draft, edge.color);
      const arrow = layoutKind === 'decision' && edge.kind !== 'annotation_link' ? 'end' : edge.arrow ?? 'end';
      return {
        type: isLine || arrow === 'none' ? 'line' as const : 'arrow' as const,
        x,
        y,
        points,
        strokeColor: edgePalette?.stroke ?? '#495057',
        strokeWidth: layoutKind === 'decision' ? 3 : 2,
        strokeStyle: edge.style ?? (edge.kind === 'loop_back' || edge.kind === 'fallback' || edge.kind === 'annotation_link' ? 'dashed' : 'solid'),
        roughness: 0.8,
        ...(isLine || arrow === 'none'
          ? {}
          : {
              endArrowhead: arrow === 'end' || arrow === 'both' ? 'arrow' as const : null,
              startArrowhead: arrow === 'start' || arrow === 'both' ? 'arrow' as const : null,
            }),
        label: labelText ? { text: labelText, fontSize: 12 } : undefined,
      };
    })
    .filter(Boolean);

  draft.nodes.forEach((node, index) => {
    const cell = layout.get(node.id);
    if (!cell) return;
    const isRoot = layoutKind === 'mindmap' && node.id === rootId;
    const outgoingCount = outgoingCountByFrom.get(node.id) ?? 0;
    const shapeType = getDiagramNodeShape(node, layoutKind, isRoot, outgoingCount);
    const colors = getDiagramNodeColors(node, layoutKind, isRoot, draft, depths.get(node.id) ?? 0, outgoingCount);
    const text = getDiagramNodeText(node);
    const textWidth = getTextBoxWidth(cell, shapeType);
    const fontSize = getDiagramTextSize(text, textWidth, shapeType, layoutKind, cell.height);
    const wrappedText = wrapTextToWidth(text, textWidth, fontSize);
    const textBox = getCenteredTextBox(wrappedText, cell, shapeType, fontSize);
    shapeElements.push(
      createShapeElement(
        `rect-${node.id}`,
        shapeType,
        cell.x,
        cell.y,
        cell.width,
        cell.height,
        colors.fill,
        colors.stroke,
        index,
        node.fillStyle,
        node.strokeStyle,
      ),
    );
    shapeElements.push(
      createTextElement(
        `text-${node.id}`,
        wrappedText,
        textBox.x,
        textBox.y,
        textBox.width,
        textBox.height,
        isRoot ? Math.max(fontSize, 22) : fontSize,
        index,
      ),
    );
  });

  return [
    ...convertToExcalidrawElements(decorationSkeletons as never),
    ...convertToExcalidrawElements(connectorSkeletons as never),
    ...shapeElements,
  ];
}

function getDiagramTextSize(
  text: string,
  width: number,
  shapeType: 'rectangle' | 'ellipse' | 'diamond',
  layoutKind: MindmapDraft['layout'],
  cellHeight: number,
): number {
  const base = layoutKind === 'decision' ? 20 : 18;
  const min = shapeType === 'diamond' ? 12 : 12;
  const maxHeight = Math.max(36, cellHeight - (shapeType === 'diamond' ? 42 : 26));
  let fontSize = base;
  while (fontSize > min) {
    const wrapped = wrapTextToWidth(text, width, fontSize);
    const lineCount = wrapped.split('\n').length;
    const longestWord = wrapped.split(/\s+/).reduce((max, word) => Math.max(max, word.length), 0);
    const longestWordWidth = longestWord * fontSize * 0.58;
    const textHeight = lineCount * fontSize * 1.25;
    if (textHeight <= maxHeight && longestWordWidth <= width) break;
    fontSize -= 1;
  }
  return fontSize;
}

function getTextBoxWidth(cell: MindmapLayoutCell, shapeType: 'rectangle' | 'ellipse' | 'diamond'): number {
  return Math.max(80, cell.width - (shapeType === 'diamond' ? 110 : 44));
}

function getCenteredTextBox(
  text: string,
  cell: MindmapLayoutCell,
  shapeType: 'rectangle' | 'ellipse' | 'diamond',
  fontSize: number,
) {
  const width = getTextBoxWidth(cell, shapeType);
  const lineCount = text.split('\n').length;
  const height = Math.min(cell.height - 22, Math.max(fontSize * 1.35, lineCount * fontSize * 1.25));
  return {
    x: cell.x + (cell.width - width) / 2,
    y: cell.y + (cell.height - height) / 2,
    width,
    height,
  };
}

function getDiagramNodeShape(
  node: MindmapNode,
  layoutKind: MindmapDraft['layout'],
  isRoot: boolean,
  _outgoingCount = 0,
): 'rectangle' | 'ellipse' | 'diamond' {
  if (node.role === 'start' || node.role === 'end') return 'ellipse';
  if (node.role === 'decision') return 'diamond';
  if (node.shape === 'ellipse') return 'ellipse';
  if (node.shape === 'diamond') {
    return layoutKind === 'decision' && !isDecisionNodeLabel(node.label) ? 'rectangle' : 'diamond';
  }
  if (node.shape === 'rectangle' || node.shape === 'rounded_rectangle' || node.shape === 'parallelogram' || node.shape === 'note' || node.shape === 'text') return 'rectangle';
  const label = `${node.id} ${node.label}`.toLowerCase();
  if (layoutKind === 'mindmap' && isRoot) return 'ellipse';
  if (layoutKind === 'decision' && isDecisionNodeLabel(label)) return 'diamond';
  if (layoutKind === 'architecture' && /\b(preload|bridge|gateway|adapter)\b/.test(label)) return 'diamond';
  return 'rectangle';
}

function createShapeElement(
  id: string,
  type: 'rectangle' | 'ellipse' | 'diamond',
  x: number,
  y: number,
  width: number,
  height: number,
  backgroundColor: string,
  strokeColor: string,
  index: number,
  fillStyle: MindmapNode['fillStyle'] = 'solid',
  strokeStyle: MindmapNode['strokeStyle'] = 'solid',
) {
  return {
    ...baseElement(id, type, x, y, width, height, index),
    strokeColor,
    backgroundColor,
    fillStyle,
    strokeStyle,
    roundness: { type: 3 },
  };
}

function createTextElement(
  id: string,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fontSize: number,
  index: number,
) {
  return {
    ...baseElement(id, 'text', x, y, width, height, index + 100),
    text,
    originalText: text,
    strokeColor: '#1f1b13',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    fontSize,
    fontFamily: 1,
    textAlign: 'center',
    verticalAlign: 'middle',
    containerId: null,
    autoResize: false,
    lineHeight: 1.25,
    roundness: null,
  };
}

function baseElement(id: string, type: string, x: number, y: number, width: number, height: number, index: number) {
  return {
    id,
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    seed: 1000 + index,
    version: 1,
    versionNonce: 2000 + index,
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
  };
}

/** BFS depth from root along directed edges — columns follow this order so arrows flow left→right. */
function computeDepthsFromRoot(draft: MindmapDraft): Map<string, number> {
  const depths = new Map<string, number>();
  const rootId = draft.nodes[0]?.id;
  if (!rootId) return depths;

  const outgoing = new Map<string, string[]>();
  for (const e of draft.edges) {
    if (!outgoing.has(e.from)) outgoing.set(e.from, []);
    outgoing.get(e.from)!.push(e.to);
  }

  depths.set(rootId, 0);
  const queue: string[] = [rootId];
  while (queue.length > 0) {
    const u = queue.shift()!;
    const du = depths.get(u)!;
    for (const v of outgoing.get(u) ?? []) {
      const next = du + 1;
      if (!depths.has(v) || depths.get(v)! > next) {
        depths.set(v, next);
        queue.push(v);
      }
    }
  }

  let maxD = 0;
  for (const d of depths.values()) maxD = Math.max(maxD, d);
  for (const n of draft.nodes) {
    if (!depths.has(n.id)) depths.set(n.id, maxD + 1);
  }
  return depths;
}

function layoutMindmapNodes(draft: MindmapDraft): Map<string, MindmapLayoutCell> {
  if (draft.nodes.some((node) => node.position)) return layoutExplicitPositionNodes(draft);
  const layoutKind = draft.layout ?? 'mindmap';
  if (layoutKind === 'cycle') return layoutCycleNodes(draft);
  if (layoutKind === 'decision') return layoutDecisionNodes(draft);
  if (layoutKind === 'flow') return layoutFlowNodes(draft);
  if (layoutKind === 'timeline') return layoutTimelineNodes(draft);
  if (layoutKind === 'architecture' || layoutKind === 'hierarchy') return layoutLayeredVerticalNodes(draft);
  if (layoutKind === 'comparison') return layoutComparisonNodes(draft);
  return layoutRadialMindmapNodes(draft);
}

function layoutExplicitPositionNodes(draft: MindmapDraft): Map<string, MindmapLayoutCell> {
  const layout = new Map<string, MindmapLayoutCell>();
  const outgoingCountByFrom = new Map<string, number>();
  for (const edge of draft.edges) {
    outgoingCountByFrom.set(edge.from, (outgoingCountByFrom.get(edge.from) ?? 0) + 1);
  }
  for (const node of draft.nodes) {
    const shape = getDiagramNodeShape(node, draft.layout ?? 'mindmap', false, outgoingCountByFrom.get(node.id) ?? 0);
    const estimated = estimateNodeBox(node, 'branch');
    if (node.position) {
      const minWidth = shape === 'diamond' ? Math.max(340, estimated.width) : Math.max(220, estimated.width);
      const minHeight = shape === 'diamond' ? Math.max(138, estimated.height) : Math.max(76, estimated.height);
      layout.set(node.id, {
        x: node.position.x,
        y: node.position.y,
        width: Math.max(node.position.w, minWidth),
        height: Math.max(node.position.h, minHeight),
      });
      continue;
    }

    layout.set(node.id, {
      x: LAYOUT_ANCHOR_X,
      y: LAYOUT_ANCHOR_Y + layout.size * 120,
      width: shape === 'diamond' ? Math.max(340, estimated.width) : estimated.width,
      height: shape === 'diamond' ? Math.max(138, estimated.height) : estimated.height,
    });
  }
  return normalizeMindmapLayout(layout);
}

function layoutDecisionNodes(draft: MindmapDraft): Map<string, MindmapLayoutCell> {
  const layout = new Map<string, MindmapLayoutCell>();
  if (draft.nodes.length === 0) return layout;

  const nodeById = new Map(draft.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, string[]>();
  const outgoingCountByFrom = new Map<string, number>();
  const indegree = new Map(draft.nodes.map((node) => [node.id, 0]));
  for (const edge of draft.edges) {
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    outgoing.get(edge.from)!.push(edge.to);
    outgoingCountByFrom.set(edge.from, (outgoingCountByFrom.get(edge.from) ?? 0) + 1);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  const rootId = draft.nodes.find((node) => (indegree.get(node.id) ?? 0) === 0)?.id ?? draft.nodes[0].id;
  const levels = new Map<string, number>([[rootId, 0]]);
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const level = levels.get(id) ?? 0;
    for (const child of outgoing.get(id) ?? []) {
      const nextLevel = level + 1;
      if (!levels.has(child) || (levels.get(child) ?? 0) < nextLevel) {
        levels.set(child, nextLevel);
        queue.push(child);
      }
    }
  }

  let maxLevel = 0;
  for (const node of draft.nodes) {
    if (!levels.has(node.id)) levels.set(node.id, maxLevel + 1);
    maxLevel = Math.max(maxLevel, levels.get(node.id) ?? 0);
  }

  const byLevel = new Map<number, string[]>();
  const orderIndex = new Map(draft.nodes.map((node, index) => [node.id, index]));
  for (const [id, level] of levels) {
    if (!byLevel.has(level)) byLevel.set(level, []);
    byLevel.get(level)!.push(id);
  }

  const centerX = LAYOUT_ANCHOR_X + 620;
  const startY = LAYOUT_ANCHOR_Y - 120;
  const rowGap = 168;
  const minColGap = 110;
  const decisionWidth = 300;

  for (let level = 0; level <= maxLevel; level += 1) {
    const ids = byLevel.get(level) ?? [];
    ids.sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));
    const boxes = ids.map((id) => {
      const node = nodeById.get(id)!;
      const base = estimateNodeBox(node, 'branch');
      const isDecision = getDiagramNodeShape(node, 'decision', false, outgoingCountByFrom.get(id) ?? 0) === 'diamond';
      return {
        id,
        width: isDecision ? Math.max(decisionWidth, base.width) : Math.max(320, base.width),
        height: isDecision ? Math.max(128, base.height) : Math.max(96, base.height),
      };
    });

    const totalWidth = boxes.reduce((sum, box) => sum + box.width, 0) + Math.max(0, boxes.length - 1) * minColGap;
    let x = centerX - totalWidth / 2;
    const maxHeight = Math.max(...boxes.map((box) => box.height), 0);
    const y = startY + level * rowGap;

    for (const box of boxes) {
      layout.set(box.id, {
        x,
        y: y + (maxHeight - box.height) / 2,
        width: box.width,
        height: box.height,
      });
      x += box.width + minColGap;
    }
  }

  return normalizeMindmapLayout(layout);
}

function layoutRadialMindmapNodes(draft: MindmapDraft): Map<string, MindmapLayoutCell> {
  const layout = new Map<string, MindmapLayoutCell>();
  if (draft.nodes.length === 0) return layout;

  const nodeById = new Map(draft.nodes.map((n) => [n.id, n]));
  const depths = computeDepthsFromRoot(draft);
  const root = draft.nodes[0];
  const rootBox = estimateNodeBox(root, 'root');
  const centerX = LAYOUT_ANCHOR_X + 520;
  const centerY = LAYOUT_ANCHOR_Y + 330;
  layout.set(root.id, {
    x: centerX - rootBox.width / 2,
    y: centerY - rootBox.height / 2,
    width: rootBox.width,
    height: rootBox.height,
  });

  let maxDepth = 0;
  const byDepth = new Map<number, string[]>();
  depths.forEach((depth, id) => {
    if (depth === 0) return;
    maxDepth = Math.max(maxDepth, depth);
    if (!byDepth.has(depth)) byDepth.set(depth, []);
    byDepth.get(depth)!.push(id);
  });

  const orderIndex = new Map(draft.nodes.map((node, index) => [node.id, index]));
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const ids = byDepth.get(depth) ?? [];
    ids.sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));
    const radiusX = Math.max(360, 280 * depth);
    const radiusY = Math.max(230, 180 * depth);

    ids.forEach((id, index) => {
      const node = nodeById.get(id);
      if (!node) return;
      const box = estimateNodeBox(node, 'branch');
      const angle =
        ids.length === 1
          ? 0
          : -Math.PI / 2 + (index / ids.length) * Math.PI * 2;
      layout.set(id, {
        x: centerX + Math.cos(angle) * radiusX - box.width / 2,
        y: centerY + Math.sin(angle) * radiusY - box.height / 2,
        width: box.width,
        height: box.height,
      });
    });
  }

  return normalizeMindmapLayout(layout);
}

function layoutCycleNodes(draft: MindmapDraft): Map<string, MindmapLayoutCell> {
  const layout = new Map<string, MindmapLayoutCell>();
  const count = draft.nodes.length;
  if (count === 0) return layout;

  const boxes = draft.nodes.map((node) => ({
    id: node.id,
    ...estimateNodeBox(node, 'branch'),
  }));
  const centerX = LAYOUT_ANCHOR_X + 520;
  const centerY = LAYOUT_ANCHOR_Y + 360;
  const radiusX = Math.max(360, count * 58);
  const radiusY = Math.max(230, count * 38);

  boxes.forEach((box, index) => {
    const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
    layout.set(box.id, {
      x: centerX + Math.cos(angle) * radiusX - box.width / 2,
      y: centerY + Math.sin(angle) * radiusY - box.height / 2,
      width: box.width,
      height: box.height,
    });
  });

  return normalizeMindmapLayout(layout);
}

function layoutFlowNodes(draft: MindmapDraft): Map<string, MindmapLayoutCell> {
  const layout = new Map<string, MindmapLayoutCell>();
  if (draft.nodes.length === 0) return layout;

  const boxes = draft.nodes.map((node) => ({
    id: node.id,
    ...estimateNodeBox(node, 'branch'),
  }));
  const gap = 130;
  let x = LAYOUT_ANCHOR_X;
  const maxHeight = Math.max(...boxes.map((box) => box.height));
  const y = LAYOUT_ANCHOR_Y + 180 - maxHeight / 2;

  boxes.forEach((box) => {
    layout.set(box.id, {
      x,
      y: y + (maxHeight - box.height) / 2,
      width: box.width,
      height: box.height,
    });
    x += box.width + gap;
  });

  return normalizeMindmapLayout(layout);
}

function layoutTimelineNodes(draft: MindmapDraft): Map<string, MindmapLayoutCell> {
  const layout = new Map<string, MindmapLayoutCell>();
  if (draft.nodes.length === 0) return layout;

  const boxes = draft.nodes.map((node) => ({
    id: node.id,
    ...estimateNodeBox(node, 'branch'),
  }));
  const gap = 150;
  let x = LAYOUT_ANCHOR_X;
  const maxHeight = Math.max(...boxes.map((box) => box.height));
  const y = LAYOUT_ANCHOR_Y + 230 - maxHeight / 2;

  boxes.forEach((box) => {
    layout.set(box.id, {
      x,
      y: y + (maxHeight - box.height) / 2,
      width: box.width,
      height: box.height,
    });
    x += box.width + gap;
  });

  return normalizeMindmapLayout(layout);
}

function layoutLayeredVerticalNodes(draft: MindmapDraft): Map<string, MindmapLayoutCell> {
  const layout = new Map<string, MindmapLayoutCell>();
  if (draft.nodes.length === 0) return layout;

  const nodeById = new Map(draft.nodes.map((node) => [node.id, node]));
  const depths = computeDepthsFromRoot(draft);
  let maxDepth = 0;
  const byDepth = new Map<number, string[]>();
  depths.forEach((depth, id) => {
    maxDepth = Math.max(maxDepth, depth);
    if (!byDepth.has(depth)) byDepth.set(depth, []);
    byDepth.get(depth)!.push(id);
  });

  const orderIndex = new Map(draft.nodes.map((node, index) => [node.id, index]));
  const centerX = LAYOUT_ANCHOR_X + 520;
  const startY = LAYOUT_ANCHOR_Y;
  const rowGap = 150;
  const colGap = 96;

  for (let depth = 0; depth <= maxDepth; depth += 1) {
    const ids = byDepth.get(depth) ?? [];
    ids.sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));
    const boxes = ids.map((id) => {
      const node = nodeById.get(id);
      if (!node) return null;
      return { id, ...estimateNodeBox(node, depth === 0 ? 'root' : 'branch') };
    }).filter(Boolean) as { id: string; width: number; height: number }[];

    const totalWidth =
      boxes.reduce((sum, box) => sum + box.width, 0) + Math.max(0, boxes.length - 1) * colGap;
    let x = centerX - totalWidth / 2;
    const maxHeight = Math.max(...boxes.map((box) => box.height), 0);
    const y = startY + depth * rowGap;

    boxes.forEach((box) => {
      layout.set(box.id, {
        x,
        y: y + (maxHeight - box.height) / 2,
        width: box.width,
        height: box.height,
      });
      x += box.width + colGap;
    });
  }

  return normalizeMindmapLayout(layout);
}

function layoutComparisonNodes(draft: MindmapDraft): Map<string, MindmapLayoutCell> {
  const layout = new Map<string, MindmapLayoutCell>();
  if (draft.nodes.length === 0) return layout;

  const boxes = draft.nodes.map((node) => ({
    id: node.id,
    ...estimateNodeBox(node, 'branch'),
  }));
  const columns = boxes.length <= 3 ? boxes.length : 2;
  const colGap = 180;
  const rowGap = 90;
  const columnWidth = 300;
  const startX = LAYOUT_ANCHOR_X;
  const startY = LAYOUT_ANCHOR_Y + 80;

  boxes.forEach((box, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    layout.set(box.id, {
      x: startX + col * (columnWidth + colGap),
      y: startY + row * (box.height + rowGap),
      width: box.width,
      height: box.height,
    });
  });

  return normalizeMindmapLayout(layout);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read PNG export.'));
    reader.readAsDataURL(blob);
  });
}

/* ────────────────────────────────────────────────
   Overlay Bar
   ──────────────────────────────────────────────── */

function OverlayBar({
  status,
  audioLevel,
  modes,
  onToggleMode,
  onCancelRecording,
}: {
  status: AppStatus;
  audioLevel: number;
  modes: OverlayDictationModes;
  onToggleMode: (mode: keyof OverlayDictationModes) => void;
  onCancelRecording: () => void;
}) {
  const isIdle = status.phase === 'idle';
  const isListening = status.phase === 'listening';
  const isProcessing = status.phase === 'transcribing' || status.phase === 'rewriting' || status.phase === 'pasting';
  const isDone = status.phase === 'done';
  const isActive = !isIdle;

  return (
    <div className="overlay-shell">
      <div className="overlay-stack">
        {isListening && (
          <div className="overlay-mode-popover" aria-label="Dictation mode">
            <ModeButton label="Terminal" active={modes.terminal} onClick={() => onToggleMode('terminal')} />
            <ModeButton label="Diagram" active={modes.diagram} onClick={() => onToggleMode('diagram')} />
          </div>
        )}
        <div className={`overlay-bar${isActive ? ' overlay-bar-active' : ''}${isProcessing ? ' overlay-processing' : ''}${isDone ? ' overlay-done' : ''}`}>
          <AudioGrid level={audioLevel} listening={isListening} processing={isProcessing} />
          <div className="overlay-copy">
            <span className="overlay-label">{isIdle ? 'Press Option to dictate' : status.title}</span>
            {isListening && (
              <button type="button" className="overlay-stop-btn" onClick={onCancelRecording} aria-label="Cancel recording">
                ■
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ModeButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`overlay-mode-btn${active ? ' overlay-mode-btn-active' : ''}`}
      onClick={onClick}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}

function AudioGrid({ level, listening, processing }: { level: number; listening: boolean; processing: boolean }) {
  const [cells, setCells] = useState<boolean[]>(() => new Array(GRID_TOTAL).fill(false));
  const seedRef = useRef(0);
  useEffect(() => {
    if (!listening) { if (!processing) setCells(new Array(GRID_TOTAL).fill(false)); return; }
    seedRef.current += 1;
    const onCount = Math.round(level * GRID_TOTAL);
    const next = new Array(GRID_TOTAL).fill(false);
    const indices = Array.from({ length: GRID_TOTAL }, (_, i) => i);
    let seed = seedRef.current;
    for (let i = indices.length - 1; i > 0; i--) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const j = seed % (i + 1);
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    for (let i = 0; i < onCount; i++) next[indices[i]] = true;
    setCells(next);
  }, [level, listening, processing]);

  return (
    <div className={`audio-grid${processing ? ' audio-grid-wave' : ''}`}>
      {cells.map((on, i) => (
        <span key={i} className={`grid-cell${on ? ' grid-cell-on' : ''}`} style={processing ? { animationDelay: `${(i % GRID_COLS) * 0.12}s` } : undefined} />
      ))}
    </div>
  );
}
