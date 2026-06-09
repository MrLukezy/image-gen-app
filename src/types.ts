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
  loading?: boolean;
  error?: string;
  timestamp: number;
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
