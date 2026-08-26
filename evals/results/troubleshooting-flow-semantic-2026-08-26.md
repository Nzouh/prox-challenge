# Agent benchmark

- Run: 2026-08-26T20:27:05.949Z → 2026-08-26T20:28:42.884Z
- Accuracy: 5/6 (83.3%)
- Completed: 5/6
- Latency: p50 12.92 s; p95 24.48 s
- First answer: p50 24.48 s; p95 24.48 s
- Total API cost: $0.1947
- Cache probe: miss in 10.851 s
- Tool routing: 7/7
- Additional-tool warnings: 2
- Artifact routing: 6/6

## Categories

- troubleshooting_flow: 5/6

## Results

| ID | Result | Latency | Cost | Tools | Artifacts |
|---|---:|---:|---:|---|---|
| flow-48 | PASS | 12.92 s | $0.0631 | diagnose_problem | troubleshooting_flow |
| flow-49 | PASS | 10.19 s | $0.0237 | diagnose_problem | troubleshooting_flow |
| flow-50 | PASS | 15.94 s | $0.0409 | diagnose_problem, get_source_page | troubleshooting_flow, source_visual |
| flow-51 | PASS | 10.42 s | $0.0231 | diagnose_problem | troubleshooting_flow |
| flow-52 | PASS | 24.48 s | $0.0440 | diagnose_problem, check_repair_scope | none |
| flow-53 | FAIL | 12.08 s | $0.0000 | lookup_spec | none |

## Failed checks

### flow-53

- completed: Evidence validation failed after 2 attempts: No successful evidence-producing MCP call completed.
- evidence:{"found":true,"spec":"maximum_ocv","tool":"lookup_spec","unit":"VDC","value":86}: observed: []
- required:\b86\s*(?:v|vdc|volts?)\b: \b86\s*(?:v|vdc|volts?)\b

Answer:

ERROR: Evidence validation failed after 2 attempts: No successful evidence-producing MCP call completed.

## Tool-efficiency warnings

- flow-50 — additional: get_source_page
- flow-52 — additional: check_repair_scope

