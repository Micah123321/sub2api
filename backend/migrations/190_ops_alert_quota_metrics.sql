-- Ops alerting: drop dead latency seed rules.
--
-- Migration 033 seeded 'P99延迟过高' / 'P95延迟过高' with metric_type
-- p99_latency_ms / p95_latency_ms. Neither value is in the handler whitelist
-- nor in the evaluator switch, so those rules can never fire: every cycle
-- counts them as enabled, then computeRuleMetric falls through to default and
-- skips them. The metric types are unusable regardless of any later edit to
-- threshold/severity, so remove every rule still carrying them.
--
-- No alert events can reference these rules (they never fired), and rule_id
-- carries no FK, so nothing else needs cleaning up.

DELETE FROM ops_alert_rules
WHERE metric_type IN ('p95_latency_ms', 'p99_latency_ms');
