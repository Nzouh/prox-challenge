# Agent benchmark

- Run: 2026-08-25T03:43:50.929Z → 2026-08-25T03:47:36.647Z
- Accuracy: 6/6 (100.0%)
- Completed: 6/6
- Latency: p50 21.60 s; p95 54.34 s
- First answer: p50 21.60 s; p95 54.34 s
- Total API cost: $0.4306
- Cache probe: miss in 18.713 s

## Categories

- power_source: 2/2
- repair_scope: 3/3
- source_page: 1/1

## Results

| ID | Result | Latency | Cost | Tools |
|---|---:|---:|---:|---|
| power-42 | PASS | 53.77 s | $0.0981 | assess_power_source |
| power-43 | PASS | 54.34 s | $0.1099 | assess_power_source, assess_power_source, assess_job_risk, assess_power_source, assess_power_source |
| repair-44 | PASS | 21.60 s | $0.0436 | check_repair_scope, assess_job_risk |
| repair-45 | PASS | 20.80 s | $0.0686 | check_repair_scope, get_setup |
| source-46 | PASS | 37.67 s | $0.0736 | get_source_page, search_manual, get_source_page |
| repair-47 | PASS | 18.82 s | $0.0368 | check_repair_scope, assess_job_risk |

## Failed checks

