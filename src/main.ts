/**
 * Remote Config Plugin for OpenCode
 *
 * Downloads organization config from HTTP endpoint and merges it
 * with the local merged config. Supports caching and fallback.
 *
 * @see https://github.com/anomalyco/opencode/blob/748fcb7ebd2df3c6b24948f5fdddeeb3fa26b867/packages/opencode/src/skill/prompt/customize-opencode.md?plain=1#L4
 * @see https://github.com/joshuadavidthomas/opencode-plugins-manual/blob/main/docs/08-sdk-client.md
 * @see https://github.com/joshuadavidthomas/opencode-plugins-manual/blob/main/docs/appendix/sdk-reference.md
 */

import type { Plugin, Config, PluginInput, PluginOptions } from "@opencode-ai/plugin";
import { fetchRemoteConfig, loadCachedConfig, cacheRemoteConfig, deepMergeConfigs } from "./utils";

const SERVICE = "opencode-remote-config";

type LoggerFunction = (level: "debug" | "info" | "warn" | "error", message: string) => void;

function createLogger(input: PluginInput): LoggerFunction {
    return (level, message) => input.client.app.log({ body: { service: SERVICE, level, message }});
}

/**
 * Main plugin function - returns hooks object
 */
const createPlugin: Plugin = async (input: PluginInput, options?: PluginOptions) => {
    const log = createLogger(input);
    const address = (options?.address as string | undefined) || process.env.OPENCODE_REMOTE_CONFIG_ADDRESS;
    const exclude = (options?.exclude as string[] | undefined) || [];
    const useCache = (options?.cache as boolean | undefined) ?? true;

    log("info", "Plugin initialized");

    if (!address) {
        log("warn", "No remote config address configured: set the \"address\" option or OPENCODE_REMOTE_CONFIG_ADDRESS env var");
        return {};
    }

    return {
        config: async (config: Config) => {
            try {
                // Try to load from cache first (if caching is enabled)
                if (useCache) {
                    const cached = await loadCachedConfig();
                    if (cached) {
                        log("debug", "Using cached config");
                        deepMergeConfigs(cached, config, { exclude });
                        return;
                    }
                }

                // Fetch fresh config
                const remote = await fetchRemoteConfig(address);

                // Cache the fresh config (if caching is enabled)
                if (useCache) {
                    await cacheRemoteConfig(remote);
                }

                deepMergeConfigs(remote, config, { exclude });

                log("info", "Config merged successfully");
            } catch (error) {
                log("error", `Failed to load remote config: ${ String(error) }` );

                // Fallback: try stale cache even if TTL expired
                if (useCache) {
                    try {
                        const stale = await loadCachedConfig(false);
                        if (stale) {
                            log("warn", "Using stale cached config as fallback");
                            deepMergeConfigs(stale, config, { exclude });
                            return;
                        }
                    } catch (fallbackError) {
                        log("error", `Fallback cache also failed: ${ String(fallbackError) }`);
                    }
                }
            }
        },
    };
};

export default createPlugin;
