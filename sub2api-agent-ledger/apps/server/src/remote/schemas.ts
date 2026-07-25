import { z } from 'zod';

export const mainServiceEnvelopeSchema = z.object({
  code: z.union([z.number(), z.string()]),
  message: z.string().optional(),
  data: z.unknown().optional(),
});

export const mainServiceUserSchema = z.object({
  id: z.union([z.number(), z.string()]),
  email: z.string().optional().default(''),
  username: z.string().optional().default(''),
  role: z.string().optional().default('user'),
  status: z.string().optional().default('unknown'),
  balance: z.number().optional().default(0),
  frozen_balance: z.number().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export const mainServicePaginatedSchema = z.object({
  items: z.array(z.unknown()).default([]),
  total: z.number().default(0),
  page: z.number().default(1),
  page_size: z.number().default(20),
  pages: z.number().optional(),
});

export const mainServiceUsageLogSchema = z.object({
  id: z.union([z.number(), z.string()]),
  user_id: z.union([z.number(), z.string()]).optional(),
  model: z.string().optional().default(''),
  input_tokens: z.number().optional().default(0),
  output_tokens: z.number().optional().default(0),
  total_cost: z.number().optional().default(0),
  actual_cost: z.number().optional(),
  created_at: z.string().optional(),
});

export type MainServiceUser = z.infer<typeof mainServiceUserSchema>;
export type MainServiceUsageLog = z.infer<typeof mainServiceUsageLogSchema>;
