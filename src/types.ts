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
