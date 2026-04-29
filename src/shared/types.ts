export type EnhancementLevel = 'none' | 'soft' | 'medium' | 'high';
export type StyleMode = 'conversation' | 'vibe-coding';

export type OverlayPhase =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'rewriting'
  | 'imaging'
  | 'pasting'
  | 'done'
  | 'error';

export type TextProvider = 'ollama' | 'openrouter';

export interface ImageStorageSettings {
  url: string;
  publishableKey: string;
  secretKey: string;
  bucket: string;
}

export interface ImageAgentSettings {
  enabled: boolean;
  /** @deprecated use top-level openrouterApiKey */
  openrouterApiKey?: string;
  imageModel: string;
}

export interface AppSettings {
  storageDirectory: string;
  whisperModel: string;
  whisperLabel: string;
  ollamaBaseUrl: string;
  textProvider: TextProvider;
  textModel: string;
  openrouterApiKey: string;
  openrouterTextModel: string;
  styleMode: StyleMode;
  enhancementLevel: EnhancementLevel;
  autoPaste: boolean;
  terminalCommandMode: boolean;
  showOverlay: boolean;
  launchAtLogin: boolean;
  setupComplete: boolean;
  imageAgent: ImageAgentSettings;
  imageStorage: ImageStorageSettings;
}

export interface PermissionsState {
  microphone: 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown';
  accessibility: boolean;
  inputMonitoring: boolean;
  postEvents: boolean;
}

export interface OllamaModelInfo {
  name: string;
  size: number;
  modifiedAt?: string;
}

export interface FocusInfo {
  canPaste: boolean;
  role?: string;
  appName?: string;
  bundleIdentifier?: string;
  processIdentifier?: number;
}

export interface AppStatus {
  phase: OverlayPhase;
  title: string;
  detail: string;
  preview?: string;
  rawText?: string;
  imageUrl?: string;
}

export interface OpenRouterModelInfo {
  id: string;
  name: string;
  description?: string;
  promptPrice?: string;
  imagePrice?: string;
  contextLength?: number;
}

export interface ImageGenerationResult {
  url: string;
  prompt: string;
  model: string;
}

export interface ImageAgentDecision {
  intent: 'image' | 'text';
  imagePrompt?: string;
  cleanedText?: string;
  reason?: string;
}

export interface BootstrapState {
  settings: AppSettings;
  permissions: PermissionsState;
  ollamaReachable: boolean;
  ollamaModels: OllamaModelInfo[];
  recommendedModelInstalled: boolean;
  speechModelReady: boolean;
  helperReady: boolean;
  status: AppStatus;
  imageStorageReady: boolean;
  textProviderReady: boolean;
}

export interface ProcessAudioResult {
  rawText: string;
  finalText: string;
  pasted: boolean;
  focusInfo?: FocusInfo;
  image?: ImageGenerationResult;
}

export interface DictationRequest {
  wavBase64: string;
  targetFocus?: FocusInfo;
  forceTerminalCommandMode?: boolean;
}

export interface HotkeyEvent {
  type: 'down' | 'up' | 'modifierChanged';
  terminalCommandMode?: boolean;
}

export interface UpdateSettingsInput {
  styleMode?: StyleMode;
  enhancementLevel?: EnhancementLevel;
  textProvider?: TextProvider;
  textModel?: string;
  openrouterApiKey?: string;
  openrouterTextModel?: string;
  ollamaBaseUrl?: string;
  storageDirectory?: string;
  autoPaste?: boolean;
  terminalCommandMode?: boolean;
  showOverlay?: boolean;
  launchAtLogin?: boolean;
  setupComplete?: boolean;
  imageAgent?: Partial<ImageAgentSettings>;
  imageStorage?: Partial<ImageStorageSettings>;
}
