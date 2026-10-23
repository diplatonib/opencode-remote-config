import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fetchRemoteConfig, deepMergeConfigs, loadCachedConfig, cacheRemoteConfig, CACHE_TTL_MS, type RemoteConfig } from "@/utils";
import fs from "fs/promises";
import path from "path";
import os from "os";

const CACHE_PATH = path.join(os.homedir(), ".cache", "opencode", "remote-config", "config.json");

const MOCK_CONFIG = {
    model: "example/pro",
    small_model: "example/fast",
    default_agent: "plan",
    share: "disabled",
    enabled_providers: ["example"],
    provider: {
        example: {
            name: "EXAMPLE 🔒",
            options: {
                apiBase: "https://api.example.com",
                apiKey: "${EXAMPLE_API_KEY}",
            },
        },
    },
    mcp: {
        searxng: {
            command: "npx",
            args: ["-y", "@anthropic/mcp-searxng"],
        },
        context7: {
            command: "npx",
            args: ["-y", "@anthropic/mcp-context7"],
        },
    },
};

describe("Remote Config Plugin", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    describe("loadRemoteConfig", () => {
        it("should load config from HTTP endpoint", async () => {
            vi.spyOn(globalThis, "fetch").mockResolvedValue({
                ok: true,
                json: async () => MOCK_CONFIG,
            } as Response);

            const config = await fetchRemoteConfig("http://any-url.json");

            expect(config.model).toBe("example/pro");
            expect(config.small_model).toBe("example/fast");
            expect(config.default_agent).toBe("plan");
            expect(config.share).toBe("disabled");
            expect(config.enabled_providers).toEqual(["example"]);
        });

        it("should load provider configuration", async () => {
            vi.spyOn(globalThis, "fetch").mockResolvedValue({
                ok: true,
                json: async () => MOCK_CONFIG,
            } as Response);

            const config = await fetchRemoteConfig("http://any-url.json");

            expect(config.provider).toBeDefined();
            expect(config.provider?.example).toBeDefined();
            expect((config.provider?.example as Record<string, unknown>)?.options).toBeDefined();
        });

        it("should load MCP servers", async () => {
            vi.spyOn(globalThis, "fetch").mockResolvedValue({
                ok: true,
                json: async () => MOCK_CONFIG,
            } as Response);

            const config = await fetchRemoteConfig("http://any-url.json");

            expect(config.mcp).toBeDefined();
            expect(config.mcp?.searxng).toBeDefined();
            expect(config.mcp?.context7).toBeDefined();
        });

        it("should throw on 404 error", async () => {
            vi.spyOn(globalThis, "fetch").mockResolvedValue({
                ok: false,
                status: 404,
                statusText: "Not Found",
            } as Response);

            await expect(fetchRemoteConfig("http://any-url.json"))
                .rejects.toThrow("Failed to fetch remote config: 404 Not Found");
        });

        it("should throw on 500 error", async () => {
            vi.spyOn(globalThis, "fetch").mockResolvedValue({
                ok: false,
                status: 500,
                statusText: "Internal Server Error",
            } as Response);

            await expect(fetchRemoteConfig("http://any-url.json"))
                .rejects.toThrow("Failed to fetch remote config: 500 Internal Server Error");
        });

        it("should throw on invalid JSON response", async () => {
            vi.spyOn(globalThis, "fetch").mockResolvedValue({
                ok: true,
                json: async () => {
                    throw new SyntaxError("Unexpected token");
                },
            } as unknown as Response);

            await expect(fetchRemoteConfig("http://any-url.json")).rejects.toThrow();
        });

        it("should throw on network error", async () => {
            vi.spyOn(globalThis, "fetch").mockRejectedValue(
                new TypeError("Failed to fetch"),
            );

            await expect(fetchRemoteConfig("http://any-url.json")).rejects.toThrow();
        });

        it("should timeout on unreachable server", async () => {
            // Mock AbortSignal.timeout to abort immediately for fast test
            const abortController = new AbortController();
            abortController.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError"));

            vi.spyOn(AbortSignal, "timeout").mockReturnValue(abortController.signal);

            await expect(fetchRemoteConfig("http://any-url.json")).rejects.toThrow();
        });
    });

    describe("mergeConfig", () => {
        it("should deep merge provider and mcp objects with local priority", () => {
            const localConfig: Record<string, unknown> = {
                model: "local/model",
                provider: { local: { name: "Local" } },
                mcp: { local: { type: "local" } },
                local_only: "value",
            };

            const remoteConfig = {
                model: "remote/model",
                provider: { remote: { name: "Remote" } },
                mcp: { remote: { type: "remote" } },
                enabled_providers: ["remote"],
            };

            deepMergeConfigs(remoteConfig, localConfig);

            // Local scalar preserved
            expect(localConfig.model).toBe("local/model");
            // Objects deep merged — both local and remote keys present, local values win on conflicts
            expect(localConfig.provider).toEqual({ local: { name: "Local" }, remote: { name: "Remote" } });
            expect(localConfig.mcp).toEqual({ local: { type: "local" }, remote: { type: "remote" } });
            // Remote fills in missing fields
            expect(localConfig.enabled_providers).toEqual(["remote"]);
            expect(localConfig.local_only).toBe("value"); // preserved
        });

        it("should deep merge overlapping nested keys with local priority", () => {
            const localConfig: Record<string, unknown> = {
                provider: { shared: { name: "Local Shared" } },
            };

            const remoteConfig = {
                provider: { shared: { name: "Remote Shared", extra: "value" } },
            };

            deepMergeConfigs(remoteConfig, localConfig);

            // 'shared' exists in both → deep merged, local 'name' wins, remote 'extra' added
            expect(localConfig.provider).toEqual({ shared: { name: "Local Shared", extra: "value" } });
        });

        it("should not touch fields not in merge list", () => {
            const localConfig: Record<string, unknown> = {
                shell: "/bin/zsh",
                logLevel: "DEBUG",
            };

            const remoteConfig = {
                model: "remote/model",
                shell: "/bin/bash", // not in merge list
            };

            deepMergeConfigs(remoteConfig, localConfig);

            // model is in merge list and local doesn't have it → filled from remote
            expect(localConfig.model).toBe("remote/model");
            // shell not in merge list → untouched
            expect(localConfig.shell).toBe("/bin/zsh");
        });

        it("should handle empty remote config", () => {
            const localConfig: Record<string, unknown> = {
                model: "local/model",
                provider: { local: {} },
            };

            deepMergeConfigs({}, localConfig);

            expect(localConfig.model).toBe("local/model");
            expect(localConfig.provider).toEqual({ local: {} });
        });

        it("should not override local scalar with null from remote", () => {
            const localConfig: Record<string, unknown> = { model: "local/model" };
            const remoteConfig = { model: null } as unknown as RemoteConfig;

            deepMergeConfigs(remoteConfig, localConfig);

            // Local takes precedence — null from remote is ignored
            expect(localConfig.model).toBe("local/model");
        });

        it("should fill missing fields from remote", () => {
            const localConfig: Record<string, unknown> = {
                model: "local/model",
            };

            const remoteConfig: RemoteConfig = {
                model: "remote/model",
                small_model: "remote/fast",
                default_agent: "plan",
                share: "disabled",
            };

            deepMergeConfigs(remoteConfig, localConfig);

            // Local preserved
            expect(localConfig.model).toBe("local/model");
            // Missing fields filled from remote
            expect(localConfig.small_model).toBe("remote/fast");
            expect(localConfig.default_agent).toBe("plan");
            expect(localConfig.share).toBe("disabled");
        });

        it("should merge small_model, default_agent, and share fields with local priority", () => {
            const localConfig: Record<string, unknown> = {
                small_model: "local/fast",
                default_agent: "general",
                share: "enabled",
            };

            const remoteConfig: RemoteConfig = {
                small_model: "remote/fast",
                default_agent: "plan",
                share: "disabled",
            };

            deepMergeConfigs(remoteConfig, localConfig);

            // All local values preserved
            expect(localConfig.small_model).toBe("local/fast");
            expect(localConfig.default_agent).toBe("general");
            expect(localConfig.share).toBe("enabled");
        });

        it("should not deep merge arrays — local wins", () => {
            const localConfig: Record<string, unknown> = {
                enabled_providers: ["local"],
            };

            const remoteConfig = {
                enabled_providers: ["remote"],
            };

            deepMergeConfigs(remoteConfig, localConfig);

            expect(localConfig.enabled_providers).toEqual(["local"]);
        });

        it("should preserve excluded nested path from local during deep merge", () => {
            const localConfig: Record<string, unknown> = {
                provider: {
                    example: { name: "Local", options: { apiKey: "local-key", }, extra: "local-extra" },
                },
            };

            const remoteConfig = {
                provider: {
                    example: { name: "Remote",options: { apiKey: "remote-key"} },
                },
            };

            deepMergeConfigs(remoteConfig, localConfig, { exclude: ["provider.example.apiKey"] });

            // Local apiKey preserved, name preserved (local wins), extra preserved
            expect((localConfig.provider as any).example.options.apiKey).toBe("local-key");
            expect((localConfig.provider as any).example.name).toBe("Local");
            expect((localConfig.provider as any).example.extra).toBe("local-extra");
        });

        it("should filter excluded path when local field is missing and remote fills it", () => {
            const localConfig: Record<string, unknown> = {};

            const remoteConfig = {
                provider: {
                    example: { name: "Remote", options: { apiKey: "remote-key" } },
                },
            };

            deepMergeConfigs(remoteConfig, localConfig, { exclude: ["provider.example.options.apiKey"] });
            console.dir(localConfig, { depth: null });
            // Provider filled from remote, but apiKey excluded
            expect((localConfig.provider as any).example.name).toBe("Remote");
            expect((localConfig.provider as any).example.options.apiKey).toBeUndefined();
        });

        it("should skip entire field when top-level key is excluded", () => {
            const localConfig: Record<string, unknown> = {
                provider: { local: { name: "Local" } },
            };

            const remoteConfig = {
                provider: { remote: { name: "Remote" } },
            };

            deepMergeConfigs(remoteConfig, localConfig, { exclude: ["provider"] });

            // Entire provider field skipped
            expect(localConfig.provider).toEqual({ local: { name: "Local" } });
        });

        it("should handle multiple exclusions across different fields", () => {
            const localConfig: Record<string, unknown> = {
                provider: { example: { name: "Local", options: {apiKey: "local-key", } } },
                mcp: { searxng: { command: "local-cmd", args: ["local-arg"] } },
            };

            const remoteConfig = {
                provider: { example: { name: "Remote", options: {apiKey: "remote-key", } } },
                mcp: { searxng: { command: "remote-cmd", args: ["remote-arg"] } },
            };

            deepMergeConfigs(remoteConfig, localConfig, {
                exclude: ["provider.example.options.apiKey", "mcp.searxng.command"],
            });

            expect((localConfig.provider as any).example.options.apiKey).toBe("local-key");
            expect((localConfig.mcp as any).searxng.command).toBe("local-cmd");
        });

        it("should behave normally without exclude option", () => {
            const localConfig: Record<string, unknown> = {
                provider: { local: { name: "Local" } },
            };

            const remoteConfig = {
                provider: { remote: { name: "Remote" } },
            };

            deepMergeConfigs(remoteConfig, localConfig);

            expect(localConfig.provider).toEqual({ local: { name: "Local" }, remote: { name: "Remote" } });
        });
    });

    describe("Cache operations", () => {
        beforeEach(async () => {
            // Clean cache before each test
            try {
                await fs.unlink(CACHE_PATH);
            } catch {
                // Ignore if not exists
            }
        });

        afterEach(async () => {
            // Clean cache after each test
            try {
                await fs.unlink(CACHE_PATH);
            } catch {
                // Ignore
            }
        });

        it("should cache and retrieve config", async () => {
            const testConfig = {
                model: "test/model",
                provider: { test: {} },
            };

            await cacheRemoteConfig(testConfig);
            const cached = await loadCachedConfig();

            expect(cached?.model).toBe("test/model");
            expect(cached?.provider).toEqual({ test: {} });
        });

        it("should return null when cache is empty", async () => {
            const cached = await loadCachedConfig();
            expect(cached).toBeNull();
        });

        it("should expire old cache", async () => {
            const testConfig = { model: "old/model" };
            await cacheRemoteConfig(testConfig);

            // Set mtime to 10 minutes ago (beyond CACHE_TTL_MS)
            const oldTime = Date.now() - CACHE_TTL_MS - 1000;
            await fs.utimes(CACHE_PATH, oldTime / 1000, oldTime / 1000);

            const cached = await loadCachedConfig();
            expect(cached).toBeNull();
        });

        it("should return null when cache contains invalid JSON", async () => {
            await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
            await fs.writeFile(CACHE_PATH, "{ invalid json }");

            const cached = await loadCachedConfig();
            expect(cached).toBeNull();
        });
    });
});
