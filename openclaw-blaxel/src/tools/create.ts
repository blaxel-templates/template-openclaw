import { Type } from "@sinclair/typebox";
import { SandboxInstance } from "@blaxel/core";
import type { BlaxelSandboxConfig } from "../config.js";
import { resolveConfig } from "../config.js";
import { cacheSandbox } from "../sandbox.js";

export const createToolDef = {
  name: "sandbox_create",
  description:
    "Create or connect to a Blaxel sandbox — a persistent, network-accessible micro VM. " +
    "Each sandbox is a fully isolated Linux environment with its own filesystem, processes, and network stack. " +
    "Sandboxes survive across calls and can host long-running applications. " +
    "Use separate sandboxes to isolate unrelated projects or concerns. " +
    "MUST be called before starting web servers or any service that needs an accessible URL. " +
    "Idempotent: safe to call multiple times with the same name (returns the existing sandbox). " +
    "Servers must bind to 0.0.0.0 to be reachable. " +
    "After starting a server, use sandbox_preview to get the public URL.",
  parameters: Type.Object({
    sandboxName: Type.String({ description: "Name for the sandbox. Use separate names to isolate unrelated projects." }),
    ports: Type.Array(Type.Number(), { description: "Ports to expose (e.g. [3000] for a web server). Must be specified at creation time." }),
    image: Type.Optional(
      Type.String({ description: "Container image. Available images with their default preview ports: 'blaxel/base-image:latest' (minimal Linux, no preview port), 'blaxel/nextjs:latest' (Next.js, preview on port 3000), 'blaxel/vite:latest' (Vite React TS, preview on port 5173), 'blaxel/astro:latest' (Astro, preview on port 4321), 'blaxel/expo:latest' (React Native/Expo, preview on port 8081), 'blaxel/py-app:latest' (Python, app on port 8000), 'blaxel/ts-app:latest' (TypeScript, app on port 3000), 'blaxel/node:latest' (Node.js, no default preview port), 'blaxel/docker-in-sandbox:latest' (Docker, app on port 3000), 'blaxel/chromium:latest' (headless Chromium, CDP on port 8081), 'blaxel/lightpanda:latest' (lightweight browser, CDP on port 8081), 'blaxel/playwright-chromium:latest' (Playwright + Chromium, playwright on port 8081), 'blaxel/playwright-firefox:latest' (Playwright + Firefox, playwright on port 8081), 'blaxel/xfce-vnc:latest' (XFCE desktop, noVNC on port 6901), 'blaxel/cua-xfce:latest' (XFCE desktop with CUA, noVNC on port 6901, computer-server on port 8000). Defaults to 'blaxel/base-image:latest'. Pick the image that matches the project type and make sure to expose the corresponding preview port." }),
    ),
    memory: Type.Optional(
      Type.Number({ description: "Memory in MB. Defaults to 4096." }),
    ),
    envs: Type.Optional(
      Type.Record(Type.String(), Type.String(), { description: "Environment variables to set in the sandbox (e.g. {\"NODE_ENV\": \"development\", \"API_KEY\": \"...\"})." }),
    ),
  }),
};

export function createCreateHandler(rawCfg: BlaxelSandboxConfig, logger?: any) {
  const cfg = resolveConfig(rawCfg);

  return async (_id: string, params: {
    sandboxName: string;
    ports: number[];
    image?: string;
    memory?: number;
    envs?: Record<string, string>;
  }) => {
    try {
      const image = params.image ?? cfg.image;
      const memory = params.memory ?? cfg.memory;

      logger?.info(`[openclaw-blaxel-sandbox] Creating sandbox "${params.sandboxName}" with ports [${params.ports.join(", ")}]…`);

      const envs = params.envs
        ? Object.entries(params.envs).map(([name, value]) => ({ name, value }))
        : undefined;

      const sandbox = await SandboxInstance.createIfNotExists({
        name: params.sandboxName,
        image,
        memory,
        labels: { "managed-by": "openclaw" },
        ports: params.ports.map((port) => ({
          name: `port-${port}`,
          target: port,
          protocol: "HTTP" as const,
        })),
        ...(envs ? { envs } : {}),
        ...(cfg.region ? { region: cfg.region } : {}),
      });

      cacheSandbox(params.sandboxName, sandbox);

      logger?.info(`[openclaw-blaxel-sandbox] Sandbox "${params.sandboxName}" ready.`);

      return {
        content: [{
          type: "text" as const,
          text: `Sandbox "${params.sandboxName}" ready with ports [${params.ports.join(", ")}] exposed. ` +
            `Image: ${image}. Memory: ${memory}MB. ` +
            `Remember: servers must bind to 0.0.0.0 to be accessible.`,
        }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `Error creating sandbox: ${err.message ?? err}` }],
        isError: true,
      };
    }
  };
}
