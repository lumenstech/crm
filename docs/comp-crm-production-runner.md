# COMP CRM production runner

The production Mac mini uses a dedicated GitHub Actions self-hosted runner label:

`comp-crm-production`

The runner is intentionally outbound-only. No public SSH or management port is required.

Production worktree:

`/Users/danny/Documents/Codex/comp-ai-crm-release-migration`

Deployment workflow:

`.github/workflows/deploy-production.yml`

The workflow calls `ops/macos/deploy-comp-crm-production.sh`, which:

1. refuses to deploy over a dirty production worktree;
2. fetches the requested Git ref;
3. optionally verifies an exact expected SHA;
4. records the current production SHA;
5. checks out the target revision detached;
6. installs locked dependencies;
7. applies Prisma migrations through the normal application database path;
8. builds the repository;
9. restarts the COMP CRM launchd services already loaded on the Mac;
10. health-checks app/API and MCP when MCP is loaded;
11. rolls back to the previous SHA if any guarded deployment step fails.

The runner must be installed once on the Mac and registered with labels `self-hosted,macOS,comp-crm-production`.
