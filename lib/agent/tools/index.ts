import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { lookupSpec } from "./lookup-spec";
import { emitArtifact } from "./emit-artifact";
import { searchManualTool } from "./search-manual";
import { assessJobRiskTool } from "./assess-job-risk";
import { getSetupTool } from "./get-setup";
import { diagnoseProblemTool } from "./diagnose-problem";
import { lookupFaultIndicatorTool } from "./lookup-fault-indicator";
import { recommendProcessTool } from "./recommend-process";
import { assessPowerSourceTool } from "./assess-power-source";
import { checkRepairScopeTool } from "./check-repair-scope";
import { getSourcePageTool } from "./get-source-page";

export const MCP_SERVER_NAME = "vulcan";

/** Runs in-process, not as a subprocess. */
export const vulcanServer = createSdkMcpServer({
  name: MCP_SERVER_NAME,
  version: "0.1.0",
  tools: [
    lookupSpec,
    getSetupTool,
    diagnoseProblemTool,
    lookupFaultIndicatorTool,
    recommendProcessTool,
    searchManualTool,
    assessJobRiskTool,
    assessPowerSourceTool,
    checkRepairScopeTool,
    getSourcePageTool,
    emitArtifact,
  ],
});

/** Plain-answer server: the model cannot select a visual tool unless the user asked for one. */
export const vulcanTextServer = createSdkMcpServer({
  name: MCP_SERVER_NAME,
  version: "0.1.0",
  tools: [
    lookupSpec,
    getSetupTool,
    diagnoseProblemTool,
    lookupFaultIndicatorTool,
    recommendProcessTool,
    searchManualTool,
    assessJobRiskTool,
    assessPowerSourceTool,
    checkRepairScopeTool,
    getSourcePageTool,
  ],
});

const qualify = (name: string) => `mcp__${MCP_SERVER_NAME}__${name}`;

export const LOOKUP_SPEC_TOOL = qualify("lookup_spec");
export const SEARCH_MANUAL_TOOL = qualify("search_manual");
export const ASSESS_JOB_RISK_TOOL = qualify("assess_job_risk");
export const GET_SETUP_TOOL = qualify("get_setup");
export const DIAGNOSE_PROBLEM_TOOL = qualify("diagnose_problem");
export const LOOKUP_FAULT_INDICATOR_TOOL = qualify("lookup_fault_indicator");
export const RECOMMEND_PROCESS_TOOL = qualify("recommend_process");
export const EMIT_ARTIFACT_TOOL = qualify("emit_artifact");
export const ASSESS_POWER_SOURCE_TOOL = qualify("assess_power_source");
export const CHECK_REPAIR_SCOPE_TOOL = qualify("check_repair_scope");
export const GET_SOURCE_PAGE_TOOL = qualify("get_source_page");
export const ALLOWED_TOOLS = [
  LOOKUP_SPEC_TOOL,
  GET_SETUP_TOOL,
  DIAGNOSE_PROBLEM_TOOL,
  LOOKUP_FAULT_INDICATOR_TOOL,
  RECOMMEND_PROCESS_TOOL,
  SEARCH_MANUAL_TOOL,
  ASSESS_JOB_RISK_TOOL,
  ASSESS_POWER_SOURCE_TOOL,
  CHECK_REPAIR_SCOPE_TOOL,
  GET_SOURCE_PAGE_TOOL,
  EMIT_ARTIFACT_TOOL,
];
export const TEXT_ALLOWED_TOOLS = [
  LOOKUP_SPEC_TOOL,
  GET_SETUP_TOOL,
  DIAGNOSE_PROBLEM_TOOL,
  LOOKUP_FAULT_INDICATOR_TOOL,
  RECOMMEND_PROCESS_TOOL,
  SEARCH_MANUAL_TOOL,
  ASSESS_JOB_RISK_TOOL,
  ASSESS_POWER_SOURCE_TOOL,
  CHECK_REPAIR_SCOPE_TOOL,
  GET_SOURCE_PAGE_TOOL,
];
