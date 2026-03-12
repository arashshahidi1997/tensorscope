# Milestone Readiness Audit

Run a readiness audit for the current milestone.

## Steps

1. Read the current milestone context doc (`docs/prompts/tensorscope-m*/00_context.md` — pick the latest milestone directory). Also read `docs/prompts/tensorscope-m*/README.md` if present.
2. Scan all modified files in git (`git diff --name-only HEAD`) for TODO and FIXME comments.
3. Check that all imports in changed frontend files resolve: run `cd frontend && npm run build 2>&1 | tail -30`.
4. Run backend tests: `conda run -n cogpy pytest -x -q 2>&1 | tail -20`.
5. Run frontend tests: `cd frontend && npm run test -- --run 2>&1 | tail -20`.
6. Summarize findings in a markdown table with columns: Area | Status | Notes. Use ✅ / ⚠️ / ❌ for Status.
7. List the top 3 gaps or risks, ordered by severity.

Do not make any code changes during an audit — only report findings.
