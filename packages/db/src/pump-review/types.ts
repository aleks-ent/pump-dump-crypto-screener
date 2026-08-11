import type { StoredPump } from "../pumps/types.js";
import type { TelegramEpisodeVoteCounts } from "../telegram-episode-voting/repository.js";

export const PUMP_CATEGORIES = [
  "sustained_move",
  "wick_spike",
  "volume_only",
  "market_move",
  "illiquid_noise",
  "unclear",
] as const;

export type PumpCategory = (typeof PUMP_CATEGORIES)[number];

export const ANNOTATION_CONFIDENCES = ["high", "medium", "low"] as const;

export type AnnotationConfidence = (typeof ANNOTATION_CONFIDENCES)[number];

export type AnnotationSource = "human" | "ai";

export type ReviewStatus = "unreviewed" | "reviewed" | "unclear";

export type PumpReviewSort =
  | "detectedAtDesc"
  | "detectedAtAsc"
  | "unreviewedFirst"
  | "symbolAsc";

export interface PumpAnnotation {
  id: string;
  eventId: string;
  source: AnnotationSource;
  category: PumpCategory;
  confidence: AnnotationConfidence | null;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertPumpAnnotationInput {
  eventId: string;
  source?: AnnotationSource;
  category: PumpCategory;
  confidence?: AnnotationConfidence | null;
  comment?: string | null;
}

export interface PumpReviewEvent {
  pump: StoredPump;
  annotation: PumpAnnotation | null;
  status: ReviewStatus;
  telegramVotes: TelegramEpisodeVoteCounts;
}

export interface PumpEventFilters {
  status?: ReviewStatus | "all";
  category?: PumpCategory;
  exchange?: string;
  symbol?: string;
  dateFromMs?: number;
  dateToMs?: number;
  sort?: PumpReviewSort;
  page?: number;
  pageSize?: number;
}

export interface PaginatedPumpReviewEvents {
  items: PumpReviewEvent[];
  page: number;
  pageSize: number;
  total: number;
}

export type PumpCategoryCounts = Record<PumpCategory, number>;

export interface PumpReviewStats {
  total: number;
  reviewed: number;
  unreviewed: number;
  unclear: number;
  reviewedPercentage: number;
  categories: PumpCategoryCounts;
}

export function isPumpCategory(value: unknown): value is PumpCategory {
  return typeof value === "string" && PUMP_CATEGORIES.includes(value as PumpCategory);
}

export function isAnnotationConfidence(
  value: unknown,
): value is AnnotationConfidence {
  return (
    typeof value === "string" &&
    ANNOTATION_CONFIDENCES.includes(value as AnnotationConfidence)
  );
}
