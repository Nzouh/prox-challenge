# Local MCP performance benchmark

Generated: 2026-08-25T03:51:17.370Z

No network or model calls are included. Times cover the deterministic functions behind the in-process MCP tools.

## Cold initialization

- p50: 160.54 ms
- p95: 197.31 ms
- range: 149.69–197.31 ms

## Warm operations

| Operation | p50 | p95 | p99 | Throughput |
|---|---:|---:|---:|---:|
| lookup_spec: published duty cycle | 174.60 µs | 433.40 µs | 1141.80 µs | 4,002 ops/s |
| lookup_spec: explicit miss | 170.90 µs | 509.00 µs | 1242.60 µs | 3,806 ops/s |
| lookup_spec: polarity | 1.10 µs | 4.60 µs | 8.10 µs | 467,212 ops/s |
| search_manual: focused hit, limit 1 | 14109.50 µs | 18775.60 µs | 20650.40 µs | 68 ops/s |
| search_manual: multi-term hit, limit 5 | 28842.20 µs | 30385.90 µs | 31464.60 µs | 34 ops/s |
| search_manual: explicit miss | 407.40 µs | 451.70 µs | 522.10 µs | 2,412 ops/s |
| assess_job_risk: stop rule | 0.40 µs | 1.90 µs | 2.40 µs | 1,261,346 ops/s |
| assess_job_risk: complete safe context | 0.80 µs | 2.30 µs | 2.80 µs | 880,320 ops/s |
| recommend_process: constrained unique match | 1.50 µs | 3.90 µs | 4.90 µs | 469,812 ops/s |
| assess_power_source: complete wall source | 1.50 µs | 5.40 µs | 5.90 µs | 465,186 ops/s |
| assess_power_source: unsupported battery | 1.40 µs | 3.20 µs | 3.50 µs | 564,997 ops/s |
| check_repair_scope: internal PCB | 3.10 µs | 4.70 µs | 5.50 µs | 280,678 ops/s |
| check_repair_scope: deenergized consumable | 11.00 µs | 12.90 µs | 24.00 µs | 83,282 ops/s |
| get_source_page: reviewed detail render | 0.50 µs | 1.50 µs | 2.00 µs | 1,258,207 ops/s |
| checker validation: deterministic stop | 0.10 µs | 0.50 µs | 0.60 µs | 3,342,693 ops/s |
| writer validation: grounded stop | 2.70 µs | 3.30 µs | 3.90 µs | 334,711 ops/s |
| MCP payload: search + JSON serialization | 10225.90 µs | 10850.90 µs | 11308.40 µs | 97 ops/s |

## Memory

- RSS: 146.10 MiB
- Heap used: 46.47 MiB
