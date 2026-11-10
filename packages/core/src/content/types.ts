export const TOPICS = ['budgeting', 'debt', 'saving', 'planning'] as const;
export type Topic = (typeof TOPICS)[number];

/**
 * Tags link lessons to situations. The platform recommends lessons by matching
 * these against a user's profile, and agents can filter the catalogue by them.
 */
export const TAGS = [
  'getting-started',
  'overspending',
  'irregular-income',
  'debt',
  'high-interest-debt',
  'borrowing',
  'emergency-fund',
  'saving',
  'goals',
] as const;
export type Tag = (typeof TAGS)[number];

/** Lesson bodies are structured blocks, not HTML or Markdown, so nothing needs sanitising to render them. */
export type Block =
  | { type: 'heading'; text: string }
  | { type: 'text'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'example'; title: string; lines: string[] }
  | { type: 'takeaway'; text: string };

export interface Question {
  prompt: string;
  options: string[];
  correctIndex: number;
  /** Shown after answering, whether right or wrong. */
  explanation: string;
}

export interface Lesson {
  slug: string;
  title: string;
  topic: Topic;
  /** 1 = no background needed, 2 = builds on the basics, 3 = more involved. */
  difficulty: 1 | 2 | 3;
  minutes: number;
  tags: Tag[];
  summary: string;
  objectives: string[];
  body: Block[];
  quiz: Question[];
}
