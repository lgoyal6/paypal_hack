// AI.migrateGlue: the rewrites a codemod cannot do (reshaping a Stripe call into
// a PayPal one, moving webhook field reads, swapping Stripe.js for PayPal
// Buttons). Constrained to the mapping table and the helper's API.
import type { CodeFile, MigrateItem, Patch } from '../contract.ts';
import { EditsSchema, applyEdits, unifiedDiff, type Edits } from '../ai/fix.ts';
import { renderFiles, structured } from '../ai/llm.ts';
import { EVENT_MAP, HELPER_API } from './glue-context.ts';

const SYSTEM = `You migrate one Stripe usage in a codebase to PayPal. Rules:
- Change only the code for the ONE inventory item given (and lines that must change with it, such as reading the result). Leave every other Stripe call untouched.
- Use only the helper already imported from paypal.js:
${HELPER_API}
- Amounts: Stripe uses integer minor units; convert with toPayPalAmount(minor, currency). Never use floats for money.
- Stripe metadata maps to customId (one string, max 127 characters). If several metadata keys exist, keep the order id and say what was dropped in a code comment starting "paydrill:".
- PayPal webhook events: event.type -> event.event_type, event.data.object -> event.resource. Event type mapping: ${JSON.stringify(EVENT_MAP)}.
  Field reads: capture/refund amount -> resource.amount.value (already a decimal string, do not divide by 100); dispute amount -> resource.dispute_amount.value; dispute reason -> resource.reason; the order id stored as customId -> resource.custom_id on captures and refunds, resource.disputed_transactions[0].custom on disputes.
- Stripe.js browser code becomes the PayPal JS SDK: paypal.Buttons({ createOrder, onApprove }).render(selector), where createOrder calls the server to create an order and onApprove calls the server to capture it.
- Each edit's "find" must be copied exactly from the file (no line-number prefixes) and be unique. No new dependencies.`;

export async function glueEdits(item: MigrateItem, files: CodeFile[]): Promise<Edits> {
  return structured(EditsSchema, SYSTEM, `<item>${JSON.stringify(item)}</item>\n\n${renderFiles(files)}`, 'xhigh');
}

export async function migrateGlue(item: MigrateItem, files: CodeFile[]): Promise<Patch> {
  const out = await glueEdits(item, files);
  const touched = files.filter((f) => out.edits.some((e) => e.path === f.path));
  return { diff: unifiedDiff(touched, applyEdits(touched, out.edits)), fixes: [item.id] };
}
