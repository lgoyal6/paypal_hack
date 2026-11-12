// paydrill shared contract. Both lanes code against these types.
// Change this file only through a PR that both Laksh and Tijil approve.

// ---------- Money ----------
/** PayPal money: decimal string, never a float, never minor units. "12.00", "1500" for JPY. */
export interface Money {
  currency_code: string;
  value: string;
}

// ---------- Events (Laksh produces, Tijil reads) ----------
/** A PayPal webhook event exactly as PayPal sent it. Never reshaped. */
export interface PayPalEvent {
  id: string;
  event_type: string;
  create_time: string;
  resource_type?: string;
  resource: Record<string, unknown>;
  summary?: string;
}

export type EventSource =
  | 'live'            // delivered by PayPal through the tunnel
  | 'live-retry'      // PayPal redelivered an id we already saw
  | 'backfill'        // PayPal recorded it but never delivered; we fetched and forwarded it
  | 'chaos-duplicate'
  | 'chaos-reorder'
  | 'chaos-forged'    // tampered copy, no valid signature; a safe handler must reject it
  | 'chaos-unknown'   // made-up event type; a safe handler must still answer 2xx
  | 'paypal-simulated'; // sent by PayPal's webhook simulator: real delivery and signature, mock payload, no real money movement

export type SignatureStatus = 'verified' | 'invalid' | 'unsigned' | 'error';

/** The local app's answer to one forwarded event. status 0 = connection failed. */
export interface HandlerResponse {
  status: number;
  ms: number;
  body: string; // first 300 chars
}

/** One delivery of one event to the developer's app. */
export interface DrillEvent {
  event: PayPalEvent;
  headers: Record<string, string>; // original paypal-* headers when present
  source: EventSource;
  signature: SignatureStatus;
  response: HandlerResponse;
  receivedAt: string; // ISO time
}

// ---------- Drill results (Laksh produces, Tijil's AI reads) ----------
export type CheckName = 'real-event' | 'duplicate' | 'out-of-order' | 'forged-unsigned' | 'unknown-type' | 'slow-response';

export interface CheckResult {
  check: CheckName;
  eventType: string;
  pass: boolean; // decided by HTTP results and assertions only, never by the AI
  response: HandlerResponse;
  note?: string;
}

export interface ScenarioResult {
  scenario: string;
  expects: string[];
  delivered: Record<string, { source: EventSource; eventId: string } | null>; // null = never arrived
  error: string | null;
  /** Event types this scenario could not produce for real and fell back to PayPal's simulator for. Always shown to the user. */
  simulated: string[];
}

export interface DrillResult {
  forwardTo: string;
  startedAt: string;
  finishedAt: string;
  scenarios: ScenarioResult[];
  deliveries: DrillEvent[];
  checks: CheckResult[];
  delivery: { expected: number; live: number; backfilled: number; simulated: number; missing: number };
}

// ---------- PayPal client (Laksh implements; needs the PayPal key) ----------
export interface Payment {
  orderId: string;
  captureId: string;
  merchantId: string;
  amount: Money;
}

export interface PayPalClient {
  cardPayment(amount: Money, description?: string): Promise<Payment>;
  refund(captureId: string, amount?: Money): Promise<{ refundId: string; status: string }>;
  chargeback(payment: Payment, reasonCode?: string): Promise<{ disputeId: string | null }>;
  getDispute(disputeId: string): Promise<Record<string, unknown>>;
  requireEvidence(disputeId: string): Promise<void>;
  submitEvidence(disputeId: string, evidence: EvidencePacket): Promise<void>;
  adjudicate(disputeId: string, outcome: 'BUYER_FAVOR' | 'SELLER_FAVOR'): Promise<void>;
  listEvents(since: string): Promise<PayPalEvent[]>;
  resendEvent(eventId: string, webhookIds?: string[]): Promise<void>;
  createWebhook(url: string): Promise<{ webhookId: string }>;
  deleteWebhook(webhookId: string): Promise<void>;
  verifySignature(headers: Record<string, string>, webhookId: string, event: PayPalEvent): Promise<SignatureStatus>;
  /** PayPal's webhook simulator. Mock payload, real delivery and signature. Use only when the sandbox cannot produce the event for real. */
  simulateEvent(webhookId: string, eventType: string): Promise<{ eventId: string }>;
}

/** All PayPal client errors are thrown as this, never swallowed. */
export interface PayPalError extends Error {
  status: number;       // HTTP status from PayPal
  debugId?: string;     // PayPal debug_id, for support
  data: unknown;        // parsed response body
}

// ---------- AI (Tijil implements; needs the Anthropic key) ----------
export interface CodeFile { path: string; text: string }

export interface Risk {
  severity: 'high' | 'medium' | 'low';
  title: string;
  where: string; // "file:line"
  why: string;
  fix: string;
}

export interface Review {
  handledEvents: string[];
  missingEvents: string[];
  risks: Risk[];
  scenarios: string[]; // scenario names to run, most important first
}

export interface Finding {
  check: string;
  result: 'pass' | 'fail' | 'warn';
  evidence: string;
  where?: string; // "file:line"
  fix?: string;
}

export interface Verdict {
  verdict: 'ship' | 'fix-first';
  summary: string;
  findings: Finding[];
}

/** Unified diff plus what it claims to fix. Applied on a branch, never in place. */
export interface Patch {
  diff: string;
  fixes: string[]; // Finding.check values this patch addresses
}

export interface EvidencePacket {
  notes: string;
  documents: { name: string; contentType: string; base64: string }[];
}

export interface AI {
  review(files: CodeFile[]): Promise<Review>;
  verdict(results: DrillResult, review: Review | null, files: CodeFile[]): Promise<Verdict>;
  fix(verdict: Verdict, files: CodeFile[]): Promise<Patch>;
  draftEvidence(dispute: Record<string, unknown>, order: Record<string, unknown>): Promise<EvidencePacket>;
  migrateGlue(item: MigrateItem, files: CodeFile[]): Promise<Patch>;
  ask(text: string): Promise<{ steps: { action: string; args: Record<string, unknown> }[]; summary: string }>;
}

// ---------- migrate (Tijil owns inventory/report; Laksh owns parity runs) ----------
export type MigrateStatus = 'supported' | 'partial' | 'unsupported';
export type MigrateBucket = 'verified' | 'migrated-unverified' | 'needs-human' | 'not-migrated';

export interface MigrateItem {
  id: string;
  kind: 'sdk-call' | 'webhook-event' | 'stripe-js' | 'header' | 'amount';
  stripe: string;   // e.g. "stripe.paymentIntents.create" or "charge.refunded"
  where: string;    // "file:line"
  status: MigrateStatus;
  paypal?: string;  // mapped target, when one exists
  reason?: string;  // required when partial or unsupported
}

export interface ParityResult {
  itemId: string;
  scenario: string;
  stripeCalls: { fn: string; args: unknown[] }[];
  paypalCalls: { fn: string; args: unknown[] }[];
  same: boolean;
}

export interface MigrateReportEntry {
  item: MigrateItem;
  bucket: MigrateBucket;
  parity?: ParityResult;
  detail: string; // plain English; failures stated first and plainly
}
