import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { lookupSpec } from "./lookup-spec";
import { emitArtifact } from "./emit-artifact";
import { searchManualTool } from "./search-manual";
import { assessJobRiskTool } from "./assess-job-risk";

export const MCP_SERVER_NAME = "vulcan";

/** Runs in-process, not as a subprocess. */
export const vulcanServer = createSdkMcpServer({
  name: MCP_SERVER_NAME,
  version: "0.1.0",
  tools: [lookupSpec, searchManualTool, assessJobRiskTool, emitArtifact],
});

const qualify = (name: string) => `mcp__${MCP_SERVER_NAME}__${name}`;

export const LOOKUP_SPEC_TOOL = qualify("lookup_spec");
export const SEARCH_MANUAL_TOOL = qualify("search_manual");
export const ASSESS_JOB_RISK_TOOL = qualify("assess_job_risk");
export const EMIT_ARTIFACT_TOOL = qualify("emit_artifact");
export const ALLOWED_TOOLS = [
  LOOKUP_SPEC_TOOL,
  SEARCH_MANUAL_TOOL,
  ASSESS_JOB_RISK_TOOL,
  EMIT_ARTIFACT_TOOL,
];
