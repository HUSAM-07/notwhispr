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
  diagramDraft?: DiagramDraft;
  mindmapDraft?: MindmapDraft;
}

export interface DictationRequest {
  wavBase64: string;
  targetFocus?: FocusInfo;
  forceTerminalCommandMode?: boolean;
  disableTerminalCommandMode?: boolean;
  forceDiagramMode?: boolean;
}

export interface DiagramNode {
  id: string;
  label: string;
  detail?: string;
  role?: string;
  shape?: 'ellipse' | 'rectangle' | 'rounded_rectangle' | 'diamond' | 'parallelogram' | 'note' | 'text';
  color?: string;
  position?: { x: number; y: number; w: number; h: number };
  subtext?: string;
  details?: string[];
  strokeStyle?: 'solid' | 'dashed' | 'dotted';
  fillStyle?: 'solid' | 'hachure' | 'cross-hatch';
  group?: string;
}

export interface DiagramEdge {
  id?: string;
  from: string;
  to: string;
  label?: string;
  kind?: string;
  style?: 'solid' | 'dashed' | 'dotted';
  arrow?: 'none' | 'end' | 'start' | 'both';
  color?: string;
  routing?: 'straight' | 'orthogonal' | 'curved';
  waypoints?: Array<{ x: number; y: number }>;
}

export type DiagramLayoutKind =
  | 'mindmap'
  | 'cycle'
  | 'decision'
  | 'flow'
  | 'timeline'
  | 'architecture'
  | 'hierarchy'
  | 'comparison';

export interface DiagramDraft {
  title: string;
  layout: DiagramLayoutKind;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  sourceText: string;
  subtitle?: string;
  palette?: Record<string, { fill: string; stroke: string; text?: string }>;
  canvas?: { width?: number; height?: number; grid?: number };
  fontFamily?: 'Virgil' | 'Helvetica' | 'Cascadia';
}

export type MindmapNode = DiagramNode;
export type MindmapEdge = DiagramEdge;
export type MindmapLayoutKind = DiagramLayoutKind;
export type MindmapDraft = DiagramDraft;

export interface MindmapPreviewRequest {
  draft: DiagramDraft;
  targetFocus?: FocusInfo;
}

export interface MindmapPngRequest {
  dataUrl: string;
  title?: string;
}

export interface CopyMindmapPngResult {
  copied: boolean;
}

export interface SaveMindmapPngResult {
  saved: boolean;
  filePath?: string;
}

export interface HotkeyEvent {
  type: 'down' | 'up' | 'modifierChanged';
  terminalCommandMode?: boolean;
  diagramMode?: boolean;
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
