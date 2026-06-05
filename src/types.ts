export interface ConvEntry {
  id: string;
  type: 'user' | 'assistant';
  prompt?: string;
  images?: string[];
  error?: string;
  loading?: boolean;
  timestamp: number;
  size?: string;
  duration?: number;
  completedAt?: number;
  imageCount?: number;
  model?: string;
  contextCount?: number;
  contextImageCount?: number;
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
