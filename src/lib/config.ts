import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { z } from 'zod';

// Tool-specific schemas
export const CompressConfigSchema = z.object({
  bitrate: z.number().min(100).max(50000).default(2500),
  preset: z
    .enum([
      'ultrafast',
      'superfast',
      'veryfast',
      'faster',
      'fast',
      'medium',
      'slow',
      'slower',
      'veryslow',
    ])
    .default('medium'),
});

export const ToGifConfigSchema = z.object({
  fps: z.number().min(1).max(60).default(15),
  width: z.number().min(100).max(1920).default(480),
  dither: z
    .enum(['none', 'floyd_steinberg', 'sierra2', 'sierra2_4a', 'bayer'])
    .default('sierra2_4a'),
  statsMode: z.enum(['full', 'diff']).default('full'),
});

export const LoopConfigSchema = z.object({});

export const ShrinkConfigSchema = z.object({
  targetDuration: z.number().min(1).max(3600).default(59.5),
});

export const Mkv2Mp4ConfigSchema = z.object({
  copyStreams: z.boolean().default(true),
  crf: z.number().min(0).max(51).default(23),
});

export const ThumbConfigSchema = z.object({});

// Hotkey preset options
export const HotkeyPresetSchema = z.enum([
  'premiere',   // Adobe Premiere Pro
  'resolve',    // DaVinci Resolve
  'capcut',     // CapCut
  'shotcut',    // Shotcut
  'descript',   // Descript
  'camtasia',   // Camtasia
]).default('premiere');

// App settings schema (non-tool settings)
export const AppSettingsSchema = z.object({
  hotkeyPreset: HotkeyPresetSchema.default('premiere'),
  cacheThreshold: z.number().min(10).max(100).default(20),
});

// Combined config schema
export const ToolsConfigSchema = z.object({
  compress: CompressConfigSchema.default({}),
  togif: ToGifConfigSchema.default({}),
  loop: LoopConfigSchema.default({}),
  shrink: ShrinkConfigSchema.default({}),
  mkv2mp4: Mkv2Mp4ConfigSchema.default({}),
  thumb: ThumbConfigSchema.default({}),
  app: AppSettingsSchema.default({}),
});

// Types
export type ToolsConfig = z.infer<typeof ToolsConfigSchema>;
export type CompressConfig = z.infer<typeof CompressConfigSchema>;
export type ToGifConfig = z.infer<typeof ToGifConfigSchema>;
export type LoopConfig = z.infer<typeof LoopConfigSchema>;
export type ShrinkConfig = z.infer<typeof ShrinkConfigSchema>;
export type Mkv2Mp4Config = z.infer<typeof Mkv2Mp4ConfigSchema>;
export type ThumbConfig = z.infer<typeof ThumbConfigSchema>;

// Defaults
const DEFAULT_CONFIG: ToolsConfig = {
  compress: { bitrate: 2500, preset: 'medium' },
  togif: { fps: 15, width: 480, dither: 'sierra2_4a', statsMode: 'full' },
  loop: {},
  shrink: { targetDuration: 59.5 },
  mkv2mp4: { copyStreams: true, crf: 23 },
  thumb: {},
  app: { hotkeyPreset: 'premiere', cacheThreshold: 20 },
};

/**
 * Get the config file path
 */
export function getConfigPath(): string {
  return path.join(os.homedir(), '.config', 'vidlet', 'config.json');
}

/**
 * Ensure config directory exists
 */
async function ensureConfigDir(): Promise<void> {
  const configDir = path.dirname(getConfigPath());
  await fs.mkdir(configDir, { recursive: true });
}

/**
 * Load JSON configuration from file
 */
async function loadJsonConfig(): Promise<unknown | null> {
  const configPath = getConfigPath();
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Save JSON configuration to file
 */
async function saveJsonConfig(data: unknown): Promise<void> {
  await ensureConfigDir();
  const configPath = getConfigPath();
  await fs.writeFile(configPath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Load tools configuration
 */
export async function loadToolsConfig(): Promise<ToolsConfig> {
  const data = await loadJsonConfig();
  if (!data) return DEFAULT_CONFIG;
  try {
    return ToolsConfigSchema.parse(data);
  } catch {
    return DEFAULT_CONFIG;
  }
}

/**
 * Save tools configuration
 */
export async function saveToolsConfig(config: ToolsConfig): Promise<void> {
  const validated = ToolsConfigSchema.parse(config);
  await saveJsonConfig(validated);
}

/**
 * Get config for a specific tool
 */
export async function getToolConfig<K extends keyof ToolsConfig>(tool: K): Promise<ToolsConfig[K]> {
  const config = await loadToolsConfig();
  return config[tool];
}

/**
 * Reset config to defaults
 */
export async function resetToolsConfig(): Promise<void> {
  await saveToolsConfig(DEFAULT_CONFIG);
}

/**
 * Get default config
 */
export function getDefaultToolsConfig(): ToolsConfig {
  return { ...DEFAULT_CONFIG };
}
