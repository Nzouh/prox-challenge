import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Do not append Next.js boilerplate to CLAUDE.md — that file carries our invariants.
  agentRules: false,

  // The Agent SDK spawns the bundled Claude Code CLI as a subprocess, so it must not
  // be traced/bundled into the server build.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],
};

export default nextConfig;
