/**
 * Remote Config Plugin utilities
 *
 * Internal functions for fetching, caching, and merging remote configuration.
 */
import type { Config } from "@opencode-ai/plugin";
import { toMerged } from "es-toolkit";
import { omit } from "es-toolkit/compat";

export interface LocalConfig extends Config {
    // All kind of props
}

export interface RemoteConfig {
    model?: string
    small_model?: string
    provider?: Record<string, unknown>
    enabled_providers?: string[]
    mcp?: Record<string, unknown>
    share?: "disabled" | "manual" | "auto"
    default_agent?: string
    [key: string]: unknown
}

export const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export async function fetchRemoteConfig(url: string): Promise<RemoteConfig> {
    const response = await fetch(url, {
        signal: AbortSignal.timeout(10000), // 10s timeout
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch remote config: ${ response.status } ${ response.statusText }`);
    }

    const data = await response.json();
    return data as RemoteConfig;
}

export async function loadCachedConfig(strict: boolean = true): Promise<RemoteConfig | null> {
    const fs = await import("fs/promises");
    const path = await import("path");
    const os = await import("os");

    const cachePath = path.join(os.homedir(), ".cache", "opencode", "remote-config", "config.json");

    try {
        const stats = await fs.stat(cachePath);
        const age = Date.now() - stats.mtimeMs;

        if (strict && age > CACHE_TTL_MS) {
            return null; // Cache expired
        }

        const content = await fs.readFile(cachePath, "utf-8");
        return JSON.parse(content) as RemoteConfig;
    } catch {
        return null; // No cache or error reading
    }
}

export async function cacheRemoteConfig(config: RemoteConfig): Promise<void> {
    const fs = await import("fs/promises");
    const path = await import("path");
    const os = await import("os");

    const cachePath = path.join(os.homedir(), ".cache", "opencode", "remote-config", "config.json");

    try {
        await fs.mkdir(path.dirname(cachePath), { recursive: true });
        await fs.writeFile(cachePath, JSON.stringify(config, null, 2));
    } catch (error) {
        console.error("[opencode-remote-config] Failed to cache config:", error);
    }
}

export interface MergeOptions {
    /**
     * Dot-notation paths to exclude from merge, e.g., ["provider.example.apiKey"]
     * Excluded paths are preserved from local config (or omitted if local doesn't have them).
     */
    exclude?: string[];
}

export const deepMergeConfigs = (base: RemoteConfig, overrides: LocalConfig, options?: MergeOptions): void => {
    const exclude = options?.exclude || [];
    const combined = toMerged(omit(base, ...exclude), overrides);

    // Apply to each pop because some proxy like behavior of and original config
    Object.entries(combined).forEach(([k, v]) => {
        (overrides as Record<string, unknown>)[k] = v;
    });
};
