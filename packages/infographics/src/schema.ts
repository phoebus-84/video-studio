import {z} from 'zod';

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a six-digit hex color');

export const PaletteSchema = z.object({
  ink: hexColor,
  paper: hexColor,
  primary: hexColor,
  secondary: hexColor,
  accent: hexColor,
  muted: hexColor,
});

export const ItemSchema = z.object({
  label: z.string().min(1).max(80),
  detail: z.string().max(180).default(''),
  tag: z.string().max(32).optional(),
  tone: z.enum(['primary', 'secondary', 'accent', 'muted']).default('primary'),
});

export const ImageSchema = z.object({
  src: z.string().min(1).max(500000),
  fit: z.enum(['cover', 'contain']).default('cover'),
  position: z.enum(['background', 'right', 'left', 'center']).default('background'),
  opacity: z.number().min(0).max(1).default(0.9),
  caption: z.string().max(180).optional(),
});

export const SceneSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  template: z.enum(['title', 'comparison', 'orbit', 'commands', 'pipeline', 'timeline', 'outro', 'feature']),
  durationInFrames: z.number().int().min(15),
  eyebrow: z.string().max(64).optional(),
  title: z.string().min(1).max(120),
  subtitle: z.string().max(260).optional(),
  items: z.array(ItemSchema).max(12).default([]),
  footer: z.string().max(160).optional(),
  metric: z.object({
    value: z.string().max(32),
    label: z.string().max(80),
  }).optional(),
  image: ImageSchema.optional(),
});

export const InfographicSpecSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1).max(100),
  width: z.number().int().min(640).max(3840).default(1920),
  height: z.number().int().min(360).max(2160).default(1080),
  fps: z.number().int().min(24).max(60).default(30),
  palette: PaletteSchema,
  brandEyebrow: z.string().max(64).optional(),
  brandFooter: z.string().max(160).optional(),
  scenes: z.array(SceneSchema).min(1).max(20),
});

export type InfographicSpec = z.infer<typeof InfographicSpecSchema>;
export type InfographicScene = z.infer<typeof SceneSchema>;
export type InfographicItem = z.infer<typeof ItemSchema>;
export type InfographicImage = z.infer<typeof ImageSchema>;

export const parseInfographicSpec = (value: unknown): InfographicSpec =>
  InfographicSpecSchema.parse(value);

export const getDurationInFrames = (spec: InfographicSpec): number =>
  spec.scenes.reduce((total, scene) => total + scene.durationInFrames, 0);
