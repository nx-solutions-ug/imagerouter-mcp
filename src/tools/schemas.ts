import { z } from 'zod';

export const prompt = z.string().trim().min(1).max(20_000);
export const model = z
  .string()
  .min(1)
  .optional()
  .describe(
    'Model id such as "openai/gpt-image-2". Use list_models to find one. Falls back to the configured default.',
  );
export const size = z
  .string()
  .regex(/^(auto|\d+x\d+)$/)
  .optional()
  .describe('"auto" or WIDTHxHEIGHT, e.g. 1024x1024. Accepted sizes depend on the model.');
export const quality = z
  .enum(['auto', 'low', 'medium', 'high'])
  .optional()
  .describe('Only honoured by models that support quality.');
export const outputFormat = z.enum(['webp', 'jpeg', 'png']).optional().describe('Default webp.');
export const seconds = z
  .union([z.literal('auto'), z.number().min(1).max(60)])
  .optional()
  .describe('Duration. Accepted values depend on the model; see list_models.');
export const mediaInputs = z
  .array(z.string().min(1))
  .max(16)
  .describe('Local file paths, http(s) URLs or data URIs. Up to 16.');
export const saving = {
  output_dir: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Directory to save into. Defaults to IMAGEROUTER_OUTPUT_DIR or ~/Pictures/imagerouter.',
    ),
  filename: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('File name without directory; the extension is set from the result.'),
  ephemeral: z
    .boolean()
    .optional()
    .describe(
      'If true the result is not stored by ImageRouter and no URL is returned, only the saved file.',
    ),
};

export function ok(data: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}
