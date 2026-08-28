# Performance Tests
Baseline 2026-08-28 (safe curl sampling, production):
login p50 ≈ 310 ms (cold max ≈ 1.0 s) · middleware redirect ≈ 160 ms ·
landing warm ≈ 330 ms / cold ≈ 860 ms. First Load JS ≈ 102 kB shared.
Load testing NOT performed against production (policy). For a real load
test: deploy a preview, mock generation providers, ramp 10→300 rps on
read routes only, record p50/p95/p99 + Supabase connections.
