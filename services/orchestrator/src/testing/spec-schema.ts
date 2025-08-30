import { z } from 'zod';

export const ToolStubVariantSchema = z.object({
  when: z.record(z.any()).optional(),
  response: z.string(),
});

export const ToolStubSchema = z.object({
  response: z.string().optional(),
  responses: z.array(ToolStubVariantSchema).optional(),
  ignoreParameters: z.boolean().optional(),
});

export const SpecSchema = z.object({
  meta: z.object({
    enabled: z.boolean().default(true),
  }).default({ enabled: true }),
  test: z.object({
    name: z.string(),
    description: z.string().optional(),
    magi: z.string(),
    baselineDate: z.string().optional(),
    timeout: z.number().optional(),
  }),
  input: z.object({
    userMessage: z.string(),
  }),
  toolStubs: z.record(ToolStubSchema).default({}),
  expectations: z.object({
    finalResponse: z.object({
      mustContain: z.array(z.string()).optional(),
      mustContainAtLeastOneOf: z.array(z.string()).optional(),
      mustNotContain: z.array(z.string()).optional(),
      minLength: z.number().optional(),
      maxLength: z.number().optional(),
    }).optional(),
    toolUsage: z.object({
      mustCall: z.array(z.string()).optional(),
      mustNotCall: z.array(z.string()).optional(),
      expectedOrder: z.array(z.object({ tool: z.string(), before: z.string() })).optional(),
      maxToolCalls: z.number().optional(),
    }).optional(),
    behavior: z.object({
      shouldComplete: z.boolean().optional(),
      maxDuration: z.number().optional(),
      shouldSpeak: z.boolean().optional(),
    }).optional(),
    planning: z.object({
      goalCount: z.object({ min: z.number().optional(), max: z.number().optional() }).optional(),
      shouldPlanFor: z.array(z.string()).optional(),
    }).optional(),
  }).optional(),
});

export type Spec = z.infer<typeof SpecSchema>;
