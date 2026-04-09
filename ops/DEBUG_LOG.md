# Radix AI Content Planner — Debug Log

Auto-maintained by `scripts/smoke-meeting.sh` and `scripts/debug-lanes.sh`.
Each entry below is a machine-written smoke/debug run.

---

## Smoke Run — 2026-04-09 18:39:49
**Branch:** v2-migration @ `b51718d`
**Result:** 8 passed, 1 failed

| Lane | Detail | Status |
|------|--------|--------|
| local_backend | health | PASS |
| local_web | frontend loads | PASS |
| desktop | 4 processes | PASS |
| vps_backend | health | PASS |
| vps_frontend | loads | PASS |
| local_backend | auth | PASS |
| local_generate | xai/grok-4-fast-reasoning 9822ms | PASS |
| delete_month | still exists | FAIL |
| vps_generate | completed | PASS |

