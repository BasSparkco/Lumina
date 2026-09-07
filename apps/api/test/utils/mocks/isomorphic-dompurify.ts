// P9 e2e tests boot the real AppModule graph, which pulls in AssetsService -> isomorphic-dompurify
// -> jsdom -> a chain of ESM-only packages Jest's default CJS transform can't parse. None of this
// suite's tests exercise TEXT-asset SVG sanitization, so a passthrough stub (mapped in via
// jest-e2e.json's moduleNameMapper) sidesteps the whole chain instead of teaching Jest to
// transform ESM — the actual sanitize() behavior stays covered by whatever hits it for real
// (unit tests that mock AssetsService's dependencies directly never load this module either way).
export default {
  sanitize: (input: string) => input,
};
