# Agent benchmark

- Run: 2026-08-26T19:24:37.426Z → 2026-08-26T19:26:18.549Z
- Accuracy: 3/6 (50.0%)
- Completed: 6/6
- Latency: p50 11.36 s; p95 23.68 s
- First answer: p50 17.30 s; p95 23.68 s
- Total API cost: $0.2283
- Cache probe: miss in 17.082 s
- Tool routing: 9/12
- Artifact routing: 6/6

## Categories

- troubleshooting_flow: 3/6

## Results

| ID | Result | Latency | Cost | Tools | Artifacts |
|---|---:|---:|---:|---|---|
| flow-48 | PASS | 11.36 s | $0.0645 | diagnose_problem | troubleshooting_flow |
| flow-49 | PASS | 8.53 s | $0.0208 | diagnose_problem | troubleshooting_flow |
| flow-50 | FAIL | 14.45 s | $0.0382 | diagnose_problem, get_source_page | troubleshooting_flow, source_visual |
| flow-51 | PASS | 8.69 s | $0.0212 | diagnose_problem | troubleshooting_flow |
| flow-52 | FAIL | 23.68 s | $0.0448 | diagnose_problem, check_repair_scope | none |
| flow-53 | FAIL | 17.30 s | $0.0388 | lookup_spec, lookup_spec, assess_power_source | none |

## Failed checks

### flow-50

- tools:unexpected: unexpected: get_source_page

Answer:

ERROR: null

### flow-52

- tools:unexpected: unexpected: check_repair_scope
- required:not (?:documented|found|validated)|unknown symptom|no matching symptom: not (?:documented|found|validated)|unknown symptom|no matching symptom

Answer:

A search for rattling noise inside the welder did not find a matching symptom in the validated troubleshooting system.

Do not proceed with internal repair. Repairs requiring the welder enclosure to be opened must be undertaken by a certified and licensed technician. Contact a qualified service facility.

### flow-53

- tools:unexpected: unexpected: assess_power_source

Answer:

The published maximum open-circuit voltage is 86 VDC.

