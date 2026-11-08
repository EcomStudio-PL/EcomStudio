/**
 * GROVBASE SHOT — the admin's process view: the shapes the server sends the
 * canvas (lib/server/grovshot-shot/process.ts builds them; pure types).
 *
 * The graph is read-only and built from the order's stored step rows: the
 * form, the card, the plan, PRODUKT + SKALA, the scene modules, each shot and
 * each of its generation calls (retries as branches), the admin's experiments.
 * A node's full detail (prompts, payload, response) is fetched on click.
 */

export type NodeStatus = "ok" | "warning" | "failed" | "running" | "pending" | "skipped";
export type NodeKind = "form" | "card" | "plan" | "product" | "scenes" | "shot" | "round" | "experiment";

export type StepRef = { pos: number; item: number; status: string; error: string | null };

export type ProcessNode = {
  id: string;
  kind: NodeKind;
  /** i18n key of the title, plus values. */
  title: { key: string; values?: Record<string, string | number> };
  status: NodeStatus;
  col: number;
  row: number;
  ms: number | null;
  costMicros: number | null;
  costUnknown: boolean;
  model: string | null;
  attempts: number;
  thumb: string | null;
  shot: number | null;
  steps: StepRef[];
  /** Short machine flags the canvas marks (no_boundary, ref_mismatch, violations, repeat…). */
  flags: string[];
  /** For an experiment node: its run. */
  runId?: string;
};

export type ProcessEdge = { from: string; to: string; kind: "flow" | "retry" | "experiment" };

export type PhotoRef = { n: number; path: string; url: string | null; sha256: string | null };

export type ShotPlanView = {
  numer: number; typ: string; opis: string; referencje: number[]; kadr: string; ludzie: string; swiatlo: string;
  miejsce: string; kierunek: string; caly_produkt: boolean;
  /** Plan rules this shot breaks after the repeat (passed through, recorded). */
  violations: string[];
};

export type ExperimentView = {
  id: string; shot: number; status: string; createdAt: string; costMicros: number | null; references: number[];
  imageUrl: string | null; published: boolean; error: string | null;
};

export type RunSummary = {
  id: string; kind: string; status: string; error: string | null; createdAt: string; finishedAt: string | null;
  customer: { id: string | null; email: string | null }; workspaceId: string | null;
  ordered: number; delivered: number; engineVersion: string | null; kbVersion: number | null;
  costMicros: number | null; costUnknown: number; retries: number;
  ratio: string | null; resolution: string | null; description: string; legacyNotes: string;
  testMode: string | null; regenOf: string | null; experimentOf: string | null;
  /** The pinned per-image price (+ the input-token guard): an experiment's estimate. */
  experimentEstimateMicros: number | null;
  /** Whether any step carries an observed network-boundary payload. */
  hasBoundary: boolean;
};

export type ProcessData = {
  run: RunSummary;
  photos: PhotoRef[];
  plan: ShotPlanView[];
  nodes: ProcessNode[];
  edges: ProcessEdge[];
  experiments: ExperimentView[];
};

export type StepDetail = {
  pos: number; item: number; status: string; attempts: number; ms: number | null; provider: string | null; model: string | null;
  inputTokens: number | null; outputTokens: number | null; costMicros: number | null; costBasis: string | null; error: string | null;
  startedAt: string | null; finishedAt: string | null;
  output: unknown;
};
