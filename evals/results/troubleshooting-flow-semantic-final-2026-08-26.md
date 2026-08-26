# Agent benchmark

- Run: 2026-08-26T20:30:27.733Z -> 2026-08-26T20:31:56.250Z
- Accuracy: 6/6 (100.0%)
- Completed: 6/6
- Latency: p50 10.19 s; p95 32.74 s
- First answer: p50 5.63 s; p95 32.74 s
- Total API cost: $0.1543
- Cache probe: miss in 5.951 s
- Tool routing: 7/7
- Additional-tool warnings: 2
- Artifact routing: 6/6

## Categories

- troubleshooting_flow: 6/6

## Results

| ID | Result | Latency | Cost | Tools | Artifacts |
|---|---:|---:|---:|---|---|
| flow-48 | PASS | 10.19 s | $0.0223 | diagnose_problem | troubleshooting_flow |
| flow-49 | PASS | 11.11 s | $0.0209 | diagnose_problem | troubleshooting_flow |
| flow-50 | PASS | 14.02 s | $0.0340 | diagnose_problem, get_source_page | troubleshooting_flow, source_visual |
| flow-51 | PASS | 8.83 s | $0.0186 | diagnose_problem | troubleshooting_flow |
| flow-52 | PASS | 32.74 s | $0.0546 | diagnose_problem, check_repair_scope, search_manual | none |
| flow-53 | PASS | 5.63 s | $0.0038 | lookup_spec | none |

## Failed checks

## Tool-efficiency warnings

- flow-50: additional: get_source_page
- flow-52: additional: check_repair_scope, search_manual
