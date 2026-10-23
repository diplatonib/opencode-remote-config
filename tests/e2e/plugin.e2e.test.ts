import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import type { PluginInput } from '@opencode-ai/plugin'
import type { Server } from 'node:http'
import { createServer } from 'node:http'
import createPlugin from '@/main'
import { cacheRemoteConfig, loadCachedConfig } from '@/utils'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

const CACHE_PATH = path.join(os.homedir(), '.cache', 'opencode', 'remote-config', 'config.json')

/** Фикстура, которую отдаёт mock-сервер */
const MOCK_REMOTE_CONFIG = {
  model: 'example/pro',
  small_model: 'example/fast',
  default_agent: 'plan',
  share: 'disabled',
  enabled_providers: ['example'],
  provider: {
    example: { name: 'EXAMPLE', options: { apiBase: 'https://api.example.com' } },
  },
  mcp: {
    searxng: { command: 'npx', args: ['-y', 'mcp-searxng'] },
  },
}

let mockServer: Server
let mockUrl: string
const originalEnv = process.env.OPENCODE_REMOTE_CONFIG_ADDRESS

/** Локальный mock-сервер: случайный порт, отдаёт фикстуру удалённого конфига */
beforeAll(async () => {
  mockServer = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(MOCK_REMOTE_CONFIG))
  })
  await new Promise<void>((resolve) => mockServer.listen(0, '127.0.0.1', resolve))
  const addr = mockServer.address()
  if (addr && typeof addr === 'object') {
    mockUrl = `http://127.0.0.1:${addr.port}/opencode.json`
  } else {
    throw new Error('mock server failed to start')
  }
})

afterAll(() => {
  // unref вместо ожидания close: undici keep-alive сокеты не дают close() резолвиться,
  // а unref снимает блокировку event loop и vitest завершается штатно
  mockServer.closeAllConnections()
  mockServer.close()
  mockServer.unref()
})

/** Minimal mock of PluginInput for testing */
const mockPluginInput: PluginInput = {
  client: {
    app: {
      log: async () => true,
    }
  } as any,
  project: {} as any,
  directory: process.cwd(),
  worktree: process.cwd(),
  experimental_workspace: { register: () => {} },
  serverUrl: new URL('http://localhost:3000'),
  $: {} as any,
}

describe('Integration: Plugin with mock server', () => {
  beforeEach(async () => {
    // Clean cache before each test
    try {
      await fs.unlink(CACHE_PATH)
    } catch {
      // Ignore if not exists
    }
  })

  afterEach(async () => {
    // Clean cache after each test
    try {
      await fs.unlink(CACHE_PATH)
    } catch {
      // Ignore
    }
  })

  it('should create plugin and call config hook with mock data', async () => {
    process.env.OPENCODE_REMOTE_CONFIG_ADDRESS = mockUrl
    try {
      const plugin = await createPlugin(mockPluginInput)

      expect(typeof plugin.config).toBe('function')

      const localConfig: Record<string, unknown> = {
        model: 'local/model',
        provider: { local: { name: 'Local Provider' } },
        mcp: { local: { type: 'local' } },
        shell: '/bin/zsh',
      }

      await plugin.config!(localConfig)

      // Local fields take precedence over remote
      expect(localConfig.model).toBe('local/model')
      // provider and mcp are deep-merged: local keys preserved + remote keys added
      expect((localConfig.provider as any)?.local).toBeDefined()
      expect((localConfig.provider as any)?.example).toBeDefined()
      expect((localConfig.mcp as any)?.local).toBeDefined()

      // Missing fields filled from remote
      expect(localConfig.small_model).toBe('example/fast')
      expect(localConfig.default_agent).toBe('plan')
      expect(localConfig.share).toBe('disabled')
      expect(localConfig.enabled_providers).toEqual(['example'])

      // Local-only fields should be preserved
      expect(localConfig.shell).toBe('/bin/zsh')
    } finally {
      process.env.OPENCODE_REMOTE_CONFIG_ADDRESS = originalEnv
    }
  }, 15000)

  it('should handle server failure gracefully', async () => {
    const plugin = await createPlugin(mockPluginInput)

    const localConfig: Record<string, unknown> = {
      model: 'local/model',
      shell: '/bin/zsh',
    }

    const savedEnv = process.env.OPENCODE_REMOTE_CONFIG_ADDRESS

    try {
      process.env.OPENCODE_REMOTE_CONFIG_ADDRESS = 'http://192.0.2.1:9999/invalid.json'

      // Should not throw - should fallback to local config
      await expect(plugin.config!(localConfig)).resolves.not.toThrow()

      // Local config should be preserved
      expect(localConfig.model).toBe('local/model')
      expect(localConfig.shell).toBe('/bin/zsh')
    } finally {
      if (savedEnv !== undefined) {
        process.env.OPENCODE_REMOTE_CONFIG_ADDRESS = savedEnv
      } else {
        delete process.env.OPENCODE_REMOTE_CONFIG_ADDRESS
      }
    }
  }, 15000)

  it('should skip merge when no address is configured', async () => {
    delete process.env.OPENCODE_REMOTE_CONFIG_ADDRESS

    try {
      const plugin = await createPlugin(mockPluginInput)

      // No address -> no config hook, nothing to merge
      expect(plugin.config).toBeUndefined()
    } finally {
      if (originalEnv !== undefined) {
        process.env.OPENCODE_REMOTE_CONFIG_ADDRESS = originalEnv
      }
    }
  }, 15000)

  it('should cache remote config and serve from cache on subsequent calls', async () => {
    process.env.OPENCODE_REMOTE_CONFIG_ADDRESS = mockUrl
    try {
      // First fetch — loads from server and caches
      const plugin = await createPlugin(mockPluginInput)
      const localConfig: Record<string, unknown> = {
        model: 'local/model',
        shell: '/bin/zsh',
      }

      await plugin.config!(localConfig)

      // Verify cache was written
      const cached = await loadCachedConfig()
      expect(cached?.model).toBe('example/pro')
      expect(cached?.small_model).toBe('example/fast')
      expect(cached?.share).toBe('disabled')

      // Local model preserved, missing fields filled from cache/remote
      expect(localConfig.model).toBe('local/model')
      expect(localConfig.small_model).toBe('example/fast')
      expect(localConfig.shell).toBe('/bin/zsh')
    } finally {
      process.env.OPENCODE_REMOTE_CONFIG_ADDRESS = originalEnv
    }
  }, 15000)

  it('should use cached config when fetch fails', async () => {
    // Write cached config first
    await cacheRemoteConfig({ model: 'cached/model', small_model: 'cached/fast' })

    const plugin = await createPlugin(mockPluginInput)
    const localConfig: Record<string, unknown> = {
      model: 'local/model',
      shell: '/bin/zsh',
    }

    const savedEnv = process.env.OPENCODE_REMOTE_CONFIG_ADDRESS

    try {
      // Force fetch to fail
      process.env.OPENCODE_REMOTE_CONFIG_ADDRESS = 'http://192.0.2.1:9999/invalid.json'

      await plugin.config!(localConfig)

      // Local model preserved (local takes precedence), missing fields filled from cache
      expect(localConfig.model).toBe('local/model')
      expect(localConfig.small_model).toBe('cached/fast')
      expect(localConfig.shell).toBe('/bin/zsh')
    } finally {
      if (savedEnv !== undefined) {
        process.env.OPENCODE_REMOTE_CONFIG_ADDRESS = savedEnv
      } else {
        delete process.env.OPENCODE_REMOTE_CONFIG_ADDRESS
      }
    }
  }, 15000)

  it("should run opencode debug config in e2e directory without errors", async () => {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);

    // Run opencode debug config in the e2e directory where opencode.json loads the plugin;
    // mock-сервер доступен через env
    const { stdout, stderr } = await execFileAsync("opencode", [
      "debug",
      "config",
      "--log-level",
      "DEBUG",
      "--print-logs",
    ], {
      cwd: __dirname,
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024, // 10MB
      env: { ...process.env, OPENCODE_REMOTE_CONFIG_ADDRESS: mockUrl },
    });

    // Parse logs from stderr — each line is a structured log entry
    const logLines = stderr.trim().split("\n").filter(Boolean);
    const errorLines = logLines.filter(line => line.includes("ERROR"));

    // No ERROR level log lines should appear
    expect(errorLines).toHaveLength(0);

    // Parse JSON config from stdout (may have log lines mixed in, extract JSON object)
    const jsonMatch = stdout.match(/\{[\s\S]*\}/);
    expect(jsonMatch).not.toBeNull();

    // opencode >= 1.18 prints the resolved config BEFORE applying plugin config hooks,
    // so merged values are not visible here; this test only asserts the plugin loads cleanly.
    // Merge behaviour is covered by the direct plugin.config tests above.
    const resolvedConfig = JSON.parse(jsonMatch![0]);
    expect(resolvedConfig).toBeDefined();
  }, 30000)

  it("should skip cache read and write when cache option is false", async () => {
    process.env.OPENCODE_REMOTE_CONFIG_ADDRESS = mockUrl
    try {
      // Pre-populate cache with stale data
      await cacheRemoteConfig({ model: "stale/model", small_model: "stale/fast" });

      const plugin = await createPlugin(mockPluginInput, { cache: false });

      const localConfig: Record<string, unknown> = {
        model: "local/model",
        shell: "/bin/zsh",
      };

      await plugin.config!(localConfig);

      // Should fetch fresh from server, NOT use stale cache
      expect(localConfig.model).toBe("local/model");
      expect(localConfig.small_model).toBe("example/fast"); // fresh from server, not stale

      // Cache file should still contain old stale data (not overwritten)
      const cached = await loadCachedConfig();
      expect(cached?.model).toBe("stale/model");
      expect(cached?.small_model).toBe("stale/fast");
    } finally {
      process.env.OPENCODE_REMOTE_CONFIG_ADDRESS = originalEnv
    }
  }, 15000)

  it("should skip cache read when cache is false even if cache exists", async () => {
    process.env.OPENCODE_REMOTE_CONFIG_ADDRESS = mockUrl
    try {
      // Write fresh cache
      await cacheRemoteConfig({ model: "cached/model", small_model: "cached/fast" });

      const plugin = await createPlugin(mockPluginInput, { cache: false });

      const localConfig: Record<string, unknown> = {
        model: "local/model",
        shell: "/bin/zsh",
      };

      await plugin.config!(localConfig);

      // Should ignore cache and fetch fresh from server
      expect(localConfig.small_model).toBe("example/fast"); // not "cached/fast"
    } finally {
      process.env.OPENCODE_REMOTE_CONFIG_ADDRESS = originalEnv
    }
  }, 15000)

  it("should use cache by default when cache option is not specified", async () => {
    process.env.OPENCODE_REMOTE_CONFIG_ADDRESS = mockUrl
    try {
      // Write cache
      await cacheRemoteConfig({ model: "cached/model", small_model: "cached/fast" });

      const plugin = await createPlugin(mockPluginInput); // no cache option

      const localConfig: Record<string, unknown> = {
        model: "local/model",
        shell: "/bin/zsh",
      };

      await plugin.config!(localConfig);

      // Should use cache
      expect(localConfig.small_model).toBe("cached/fast");
    } finally {
      process.env.OPENCODE_REMOTE_CONFIG_ADDRESS = originalEnv
    }
  }, 15000)

  it("should use cache when cache option is explicitly true", async () => {
    process.env.OPENCODE_REMOTE_CONFIG_ADDRESS = mockUrl
    try {
      // Write cache
      await cacheRemoteConfig({ model: "cached/model", small_model: "cached/fast" });

      const plugin = await createPlugin(mockPluginInput, { cache: true });

      const localConfig: Record<string, unknown> = {
        model: "local/model",
        shell: "/bin/zsh",
      };

      await plugin.config!(localConfig);

      // Should use cache
      expect(localConfig.small_model).toBe("cached/fast");
    } finally {
      process.env.OPENCODE_REMOTE_CONFIG_ADDRESS = originalEnv
    }
  }, 15000)
})
