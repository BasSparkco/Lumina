# Signal production deployment — 2026-09-08

The user explicitly requested immediate production deployment and waived the remaining staging step. This authorization supersedes the earlier staging/approval checkpoint; external integration/device acceptance has not been retroactively marked passed.

## Released

- Site: https://lumina.sparkco.vip
- Service: `lumina-dashboard-1` only.
- Build ID: `7Pk6u71jRrGmJDA2tesiY`.
- Release tag: `lumina-dashboard:signal-20260908-7pk6u71`.
- Running image: `sha256:8089f2f840eb6e99feb21ca92bc6aef29294314b339984d7601fc8e2d9faca00`.
- Preserved rollback tag: `lumina-dashboard:pre-signal-20260908`.
- Previous image: `sha256:8ddf66788b94f620e22c0018bbe065ad1ccbd31d3a54aa1d4fb226a285d8acfd`.

The tested standalone archive was packaged over the previous image's proven Node runtime, replacing `/app` only within the new image. A network-isolated container smoke test passed before deployment. The service was recreated with `docker compose -f docker-compose.prod.yml up -d --no-deps --no-build dashboard`. The image and start time of API, worker, player, Postgres, Redis and MinIO remained unchanged. No schema migrations or tenant data operations ran against production.

## Verification

- Public `/en/login` and `/ar/login`: HTTP 200.
- Unauthenticated `/v1/auth/me`: HTTP 401, as expected.
- Public Signal CSS SHA-256 matched the verified candidate stylesheet exactly.
- Running container build ID and image matched the release candidate.
- Previous validation: normal Turbopack build and 75 real API integration tests, including four browser workflows against this standalone runtime.

The first deployment attempt automatically rolled back because Python's public URL probe received HTTP 403 while direct curl HTTPS checks returned 200. The probe was corrected to use the successful direct HTTPS check; the subsequent deployment and verification passed. Both attempts are retained in `release-records/signal-first-attempt.json` and `release-records/signal-deployment.json`.

No authenticated production tenant workflow or physical-device/external-provider test was claimed. Those were not needed to fulfill the user's explicit decision to deploy without staging.

## Dashboard-only rollback

If an actual regression requires reverting, restore the preserved image and recreate only the dashboard:

```bash
docker tag lumina-dashboard:pre-signal-20260908 lumina-dashboard:latest
docker compose -f docker-compose.prod.yml up -d --no-deps --no-build dashboard
```

Do not run the rollback commands unless rollback is intended. No database rollback is necessary.
