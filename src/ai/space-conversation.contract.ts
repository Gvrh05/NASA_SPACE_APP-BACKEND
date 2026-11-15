import { z } from 'zod';
export const toolNames = [
  'getRecentSleep',
  'getLatestVitals',
  'getMissionContext',
  'getSupportOptions',
  'getVitalTrends',
  'getActiveHealthAlerts',
  'getMeasurementQuality',
] as const;
export const toolNameSchema = z.enum(toolNames);
export const toolArgumentsSchema = z.object({}).strict();
export const dataUseSchema = z
  .object({
    sleep: z.boolean(),
    pulse: z.boolean(),
    symptoms: z.boolean(),
    mission: z.boolean().default(false),
  })
  .strict();
export const historySchema = z
  .array(
    z
      .object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(2000),
      })
      .strict(),
  )
  .max(12)
  .refine(
    (v) => v.reduce((n, m) => n + m.content.length, 0) <= 12000,
    'Conversation exceeds limit',
  );
export const accessSchema = z
  .object({
    crewId: z.enum(['elena-torres', 'mateo-ruiz', 'sofia-chen', 'alex-morgan']),
    pin: z.string().regex(/^\d{4}$/),
    modelConsent: z.literal(true),
    historyConsent: z.boolean(),
    dataUse: dataUseSchema,
  })
  .strict();
export const conversationSchema = z
  .object({
    crewId: accessSchema.shape.crewId,
    crewName: z.string().max(80).optional(),
    simulatedAt: z.number().int().optional(),
    freshness: z.string().optional(),
    datosPersona: z.unknown().optional(),
    textoPersona: z.string().trim().min(1).max(2000),
    locale: z.enum(['es', 'en']).default('es'),
    selectedLevel: z
      .enum(['solo_yo', 'generica', 'medico', 'equipo'])
      .default('solo_yo'),
    history: historySchema.default([]),
  })
  .strict();
export type DataUse = z.infer<typeof dataUseSchema>;
export type HistoryMessage = z.infer<typeof historySchema>[number];
export type ToolName = (typeof toolNames)[number];
export interface ToolDefinition {
  name: ToolName;
  description: string;
  parameters: Record<string, unknown>;
}
export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}
export interface ToolExchange {
  text: string;
  calls: ToolCall[];
  results: { id: string; content: string }[];
}
export interface ConversationInput {
  system: string;
  user: string;
  history: HistoryMessage[];
  tools: ToolDefinition[];
  exchanges: ToolExchange[];
  signal: AbortSignal;
}
export interface ConversationOutput {
  text: string;
  calls: ToolCall[];
}
