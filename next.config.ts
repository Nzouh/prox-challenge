import type { NextConfig } from "next";

const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";
const basePath = configuredBasePath === "/" ? "" : configuredBasePath.replace(/\/$/, "");

if (basePath && !/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(basePath)) {
  throw new Error("NEXT_PUBLIC_BASE_PATH must be empty or an absolute path such as /arc.");
}

const nextConfig: NextConfig = {
  basePath,

  // Do not append Next.js boilerplate to CLAUDE.md — that file carries our invariants.
  agentRules: false,

  // The Agent SDK spawns the bundled Claude Code CLI as a subprocess, so it must not
  // be traced/bundled into the server build.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],

  // Knowledge files are read through dynamic, validated paths. Explicit tracing keeps
  // those files available in Vercel functions and standalone/container builds.
  outputFileTracingIncludes: {
    "/api/chat": ["./knowledge/**/*"],
    "/api/source-assets": ["./knowledge/**/*"],
  },
};

export default nextConfig;
