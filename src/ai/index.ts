// The AI lane, implementing the AI interface from the shared contract.
import type { AI } from '../contract.ts';
import { review } from './review.ts';
import { verdict } from './verdict.ts';
import { fix } from './fix.ts';
import { draftEvidence } from './evidence.ts';
import { migrateGlue } from '../migrate/glue.ts';
import { ask } from './ask.ts';

export const ai: AI = { review, verdict, fix, draftEvidence, migrateGlue, ask };

export { readCodeFiles } from './llm.ts';
export { doctor } from './doctor.ts';
export { runPlan } from './ask.ts';
export { applyOnBranch, removeWorktree } from './branch.ts';
