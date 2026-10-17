# AuraAI Content Planner — Debug Log

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


## Smoke Run — 2026-04-09 18:46:05
**Branch:** v2-migration @ `0bfb5da`
**Result:** 9 passed, 0 failed

| Lane | Detail | Status |
|------|--------|--------|
| local_backend | health | PASS |
| local_web | frontend loads | PASS |
| desktop | 4 processes | PASS |
| vps_backend | health | PASS |
| vps_frontend | loads | PASS |
| local_backend | auth | PASS |
| local_generate | xai/grok-4-fast-reasoning 8322ms | PASS |
| delete_month | 404 after delete | PASS |
| vps_generate | completed | PASS |


## Smoke Run — 2026-04-09 19:34:39
**Branch:** v2-migration @ `fb4c179`
**Result:** 9 passed, 0 failed

| Lane | Detail | Status |
|------|--------|--------|
| local_backend | health | PASS |
| local_web | frontend loads | PASS |
| desktop | 4 processes | PASS |
| vps_backend | health | PASS |
| vps_frontend | loads | PASS |
| local_backend | auth | PASS |
| local_generate | xai/grok-4-fast-reasoning 9682ms | PASS |
| delete_month | 404 after delete | PASS |
| vps_generate | completed | PASS |


## Smoke Run — 2026-04-09 20:22:23
**Branch:** v2-migration @ `7b93b75`
**Result:** 9 passed, 0 failed

| Lane | Detail | Status |
|------|--------|--------|
| local_backend | health | PASS |
| local_web | frontend loads | PASS |
| desktop | 4 processes | PASS |
| vps_backend | health | PASS |
| vps_frontend | loads | PASS |
| local_backend | auth | PASS |
| local_generate | xai/grok-4-fast-reasoning 9511ms | PASS |
| delete_month | 404 after delete | PASS |
| vps_generate | completed | PASS |


## Smoke Run — 2026-04-10 21:46:59
**Branch:** v2-migration @ `c8c80bf`
**Result:** 7 passed, 2 failed

| Lane | Detail | Status |
|------|--------|--------|
| local_backend | health | PASS |
| local_web | frontend loads | PASS |
| desktop | not running | FAIL |
| vps_backend | health | PASS |
| vps_frontend | loads | PASS |
| local_backend | auth | PASS |
| local_generate | xai/grok-4-fast-reasoning 8329ms | PASS |
| delete_month | 404 after delete | PASS |
| vps_generate | Brief completeness too low (0%). Need at least 50%. | FAIL |


## Smoke Run — 2026-04-10 21:47:49
**Branch:** v2-migration @ `c8c80bf`
**Result:** 8 passed, 1 failed

| Lane | Detail | Status |
|------|--------|--------|
| local_backend | health | PASS |
| local_web | frontend loads | PASS |
| desktop | not running | FAIL |
| vps_backend | health | PASS |
| vps_frontend | loads | PASS |
| local_backend | auth | PASS |
| local_generate | xai/grok-4-fast-reasoning 8460ms | PASS |
| delete_month | 404 after delete | PASS |
| vps_generate | completed | PASS |


## Smoke Run — 2026-04-11 01:46:47
**Branch:** million-dollar-hardening @ `ceb4465`
**Result:** 8 passed, 1 failed

| Lane | Detail | Status |
|------|--------|--------|
| local_backend | health | PASS |
| local_web | frontend loads | PASS |
| desktop | not running | FAIL |
| vps_backend | health | PASS |
| vps_frontend | loads | PASS |
| local_backend | auth | PASS |
| local_generate | xai/grok-4-fast-reasoning 5226ms | PASS |
| delete_month | 404 after delete | PASS |
| vps_generate | completed | PASS |


## Smoke Run — 2026-04-11 02:05:28
**Branch:** million-dollar-hardening @ `6764447`
**Result:** 8 passed, 1 failed

| Lane | Detail | Status |
|------|--------|--------|
| local_backend | health | PASS |
| local_web | frontend loads | PASS |
| desktop | not running | FAIL |
| vps_backend | health | PASS |
| vps_frontend | loads | PASS |
| local_backend | auth | PASS |
| local_generate | xai/grok-4-fast-reasoning 6816ms | PASS |
| delete_month | 404 after delete | PASS |
| vps_generate | completed | PASS |


## Smoke Run — 2026-04-11 02:38:14
**Branch:** million-dollar-hardening @ `32043c7`
**Result:** 8 passed, 1 failed

| Lane | Detail | Status |
|------|--------|--------|
| local_backend | health | PASS |
| local_web | frontend loads | PASS |
| desktop | not running | FAIL |
| vps_backend | health | PASS |
| vps_frontend | loads | PASS |
| local_backend | auth | PASS |
| local_generate | xai/grok-4-fast-reasoning 7466ms | PASS |
| delete_month | 404 after delete | PASS |
| vps_generate | completed | PASS |


## Smoke Run — 2026-04-12 00:07:07
**Branch:** million-dollar-hardening @ `af1ea25`
**Result:** 7 passed, 2 failed

| Lane | Detail | Status |
|------|--------|--------|
| local_backend | health | PASS |
| local_web | frontend loads | FAIL |
| desktop | not running | FAIL |
| vps_backend | health | PASS |
| vps_frontend | loads | PASS |
| local_backend | auth | PASS |
| local_generate | xai/grok-4-fast-reasoning 10067ms | PASS |
| delete_month | 404 after delete | PASS |
| vps_generate | completed | PASS |
