// Runs before any test file is loaded (see jest-e2e.json's setupFiles) — early enough that
// AppModule's LoggerModule.forRoot() (evaluated at import time, not lazily) picks this up.
// Without it, every request in every e2e test logs its full request/response object at 'info'
// level, drowning real test output and CI logs in noise unrelated to what actually failed.
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';
