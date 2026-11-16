import { z } from 'zod';
import {
  crewId,
  kind,
  mutationSchema,
  packetSchema,
} from '../simulation/contracts';
import { parse } from '../simulation/contracts';

export const parseQuery = parse;
export const parseBody = parse;

export const integrity = z.enum(['valid', 'pending', 'stale']);
export const rejectionReason = z.enum(['duplicate', 'altered', 'out_of_order']);

const at = z.coerce.number().int().nonnegative().optional();
const limit = z.coerce.number().int().min(1).max(500).default(200);
const offset = z.coerce.number().int().nonnegative().default(0);

const rangeIsOrdered = (q: { from?: number; to?: number }) =>
  q.from === undefined || q.to === undefined || q.from <= q.to;

export const historyQuerySchema = z
  .object({
    crewId,
    kind: kind.optional(),
    from: at,
    to: at,
    integrity: integrity.optional(),
    limit,
    offset,
  })
  .strict()
  .refine(rangeIsOrdered, 'Invalid interval');

export const latestQuerySchema = z.object({ crewId, kind }).strict();

export const summaryQuerySchema = z.object({ crewId }).strict();

export const rejectionsQuerySchema = z
  .object({
    crewId: crewId.optional(),
    reason: rejectionReason.optional(),
    from: at,
    to: at,
    limit,
    offset,
  })
  .strict()
  .refine(rangeIsOrdered, 'Invalid interval');

export const ingestSchema = mutationSchema
  .extend({ simulated: z.literal(true), packet: packetSchema })
  .strict();

export type HistoryQuery = z.infer<typeof historyQuerySchema>;
export type LatestQuery = z.infer<typeof latestQuerySchema>;
export type SummaryQuery = z.infer<typeof summaryQuerySchema>;
export type RejectionsQuery = z.infer<typeof rejectionsQuerySchema>;
export type IngestInput = z.infer<typeof ingestSchema>;
