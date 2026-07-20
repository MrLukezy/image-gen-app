export interface BatchTask {
  id: number;
  status: 'loading' | 'success' | 'failed';
  image?: string;
  error?: string;
}

export interface ConvEntry {
  id: string;
  type: 'user' | 'assistant';
  prompt?: string;
  images?: string[];
  refImages?: string[];
  videoUrl?: string;
  thumbnailUrl?: string;
  progress?: string;
  orientation?: string;
  kind?: 'image' | 'video';
  error?: string;
  loading?: boolean;
  timestamp: number;
  size?: string;
  duration?: number;
  completedAt?: number;
  imageCount?: number;
  model?: string;
  contextImageCount?: number;
  batchId?: string;
  batchTotal?: number;
  batchImages?: BatchTask[];
  batchErrors?: number;
}

export interface Conversation {
  id: string;
  title: string;
  entries: ConvEntry[];
  createdAt: number;
  updatedAt: number;
}

export interface ConvSummary {
  id: string;
  title: string;
  updatedAt: number;
}

export interface ApiConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
}

export interface StoredState {
  conversationId: string;
  apiUrl: string;
  apiKey: string;
  model: string;
  openConvIds: string[];
}

export interface TrashItem {
  id: string;
  title: string;
  imageCount: number;
  createdAt: number;
  updatedAt: number;
  movedAt: number;
}

export interface McpConversation {
  id: string;
  title: string;
  entries: ConvEntry[];
  createdAt: number;
  updatedAt: number;
  source?: string;
}

export interface ExtractTask {
  id: string;
  type: 'user' | 'assistant';
  sourceImage: string;
  extractType?: string;
  resultText?: string;
  resultImage?: string;
  resultImages?: string[];
  loading?: boolean;
  error?: string;
  timestamp: number;
  step?: 'analyzing' | 'generating';
  groupTitles?: string[];
}

export interface ExtractConversation {
  id: string;
  title: string;
  sourceImage: string;
  tasks: ExtractTask[];
  createdAt: number;
  updatedAt: number;
}

export interface FavoriteItem {
  id: string;
  imageUrl: string;
  folderId: string;
  name?: string;
  tags?: string[];
  sourceConversationId?: string;
  sourceEntryId?: string;
  createdAt: number;
}

export interface FavoriteFolder {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  createdAt: number;
}

export interface AnimationTask {
  id: string;
  type: 'user' | 'assistant';
  actionName: string;
  frameCount: number;
  spriteSheet?: string;
  finalFrames?: string[];
  referenceImages?: string[];
  loading?: boolean;
  error?: string;
  timestamp: number;
  step?: 'generating_sheets' | 'generating_frames';
}

export interface AnimationConversation {
  id: string;
  title: string;
  characterName: string;
  tasks: AnimationTask[];
  createdAt: number;
  updatedAt: number;
}

// ──────────────────────────── Video ────────────────────────────────────────

export type VideoModel = 'sora-2' | 'sd-2' | 'sd-2-vip' | 'Kling Omni';
export type VideoOrientation = 'landscape' | 'portrait' | 'square';

export interface VideoTask {
  id: string;
  type: 'user' | 'assistant';
  prompt: string;
  model: string;
  orientation: VideoOrientation;
  duration: string;
  referenceImages?: string[];
  referenceVideos?: string[];
  referenceAudios?: string[];
  startFrameImage?: string;
  endFrameImage?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  loading?: boolean;
  error?: string;
  progress?: string;
  timestamp: number;
  completedAt?: number;
}

export interface VideoConversation {
  id: string;
  title: string;
  tasks: VideoTask[];
  createdAt: number;
  updatedAt: number;
}

// ──────────────────────────── PSD ────────────────────────────────────────

export interface PsdLayerNode {
  id: string;
  name: string;
  left: number;
  top: number;
  width: number;
  height: number;
  opacity: number;
  hidden: boolean;
  previewDataUrl: string;
  children?: PsdLayerNode[];
}

export interface PsdConversation {
  id: string;
  title: string;
  mode: 'import' | 'export';
  sourceImage: string;
  width: number;
  height: number;
  layers: PsdLayerNode[];
  status: 'idle' | 'analyzing' | 'generating' | 'building' | 'done' | 'error';
  error?: string;
  analysisText?: string;
  groupTitles?: string[];
  createdAt: number;
  updatedAt: number;
}
