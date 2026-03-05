import { z } from "zod";
import {
  blitzActionStatusValues,
  attributionWindowValues,
  blitzActionTypeValues,
  blitzPhaseValues,
  blitzRunStatusValues,
  policyDecisionValues,
  riskTierValues,
  roleValues
} from "./types";

export const orgRoleSchema = z.enum(roleValues);
export const blitzRunStatusSchema = z.enum(blitzRunStatusValues);
export const blitzPhaseSchema = z.enum(blitzPhaseValues);
export const blitzActionTypeSchema = z.enum(blitzActionTypeValues);
export const blitzActionStatusSchema = z.enum(blitzActionStatusValues);
export const riskTierSchema = z.enum(riskTierValues);
export const policyDecisionSchema = z.enum(policyDecisionValues);
export const attributionWindowSchema = z.enum(attributionWindowValues);

export const createOrgSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
  ownerEmail: z.string().email()
});

export const createClientSchema = z.object({
  name: z.string().min(2),
  timezone: z.string().default("America/Chicago"),
  websiteUrl: z.string().url().optional(),
  primaryLocationLabel: z.string().optional()
});

export const createBlitzRunSchema = z.object({
  playbookId: z.string().uuid().optional(),
  policySnapshot: z.record(z.unknown()).default({}),
  triggeredBy: z.string().min(1)
});

export const upsertAutopilotPolicySchema = z.object({
  maxDailyActionsPerLocation: z.number().int().positive(),
  maxActionsPerPhase: z.number().int().positive(),
  minCooldownMinutes: z.number().int().nonnegative(),
  denyCriticalWithoutEscalation: z.boolean(),
  enabledActionTypes: z.array(blitzActionTypeSchema).min(1),
  reviewReplyAllRatingsEnabled: z.boolean()
});

export const connectIntegrationSchema = z.object({
  providerAccountId: z.string().min(1),
  scopes: z.array(z.string()).default([]),
  metadata: z.record(z.unknown()).default({})
});

export const upsertClientOrchestrationSettingsSchema = z.object({
  tone: z.string().min(2).max(120),
  objectives: z.array(z.string().min(2).max(180)).min(1).max(20),
  photoAssetUrls: z.array(z.string().url()).max(200).default([]),
  photoAssetIds: z.array(z.string().uuid()).max(200).default([]),
  sitemapUrl: z.string().url().nullable(),
  defaultPostUrl: z.string().url().nullable(),
  reviewReplyStyle: z.string().min(2).max(80),
  postFrequencyPerWeek: z.number().int().min(0).max(21).default(3),
  postWordCountMin: z.number().int().min(120).max(2000).default(500),
  postWordCountMax: z.number().int().min(120).max(2000).default(800),
  eeatStructuredSnippetEnabled: z.boolean().default(true),
  metadata: z.record(z.unknown()).default({})
}).superRefine((value, ctx) => {
  if (value.postWordCountMin > value.postWordCountMax) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["postWordCountMin"],
      message: "postWordCountMin must be less than or equal to postWordCountMax"
    });
  }
});

export const createApiKeySchema = z.object({
  name: z.string().min(2),
  scopes: z.array(z.string()).default([]),
  expiresAt: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).default({})
});

export type CreateOrgInput = z.infer<typeof createOrgSchema>;
export type CreateClientInput = z.infer<typeof createClientSchema>;
export type CreateBlitzRunInput = z.infer<typeof createBlitzRunSchema>;
export type UpsertAutopilotPolicyInput = z.infer<typeof upsertAutopilotPolicySchema>;
export type ConnectIntegrationInput = z.infer<typeof connectIntegrationSchema>;
export type UpsertClientOrchestrationSettingsInput = z.infer<typeof upsertClientOrchestrationSettingsSchema>;
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
