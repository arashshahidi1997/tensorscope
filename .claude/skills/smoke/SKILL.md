# Smoke Test

Run a quick sanity check after edits. Stop at first failure and report it clearly.

## Steps

1. Frontend build: `cd /storage2/arash/projects/tensorscope/frontend && npm run build 2>&1 | tail -30`
   - If it fails, stop here and report the error. Do not continue.
2. Frontend tests: `cd /storage2/arash/projects/tensorscope/frontend && npm run test -- --run 2>&1 | tail -20`
   - If any tests fail, stop here and report which tests failed and why.
3. Backend tests: `conda run -n cogpy pytest /storage2/arash/projects/tensorscope -x -q 2>&1 | tail -20`
   - If any tests fail, stop here and report the failure.
4. If all pass, output: "✅ Smoke test passed — build clean, all tests green."

Report failures with the exact error output, the file and line if available, and a one-sentence diagnosis.
