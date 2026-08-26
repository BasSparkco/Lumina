import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    // `rootDir` here is required as of TypeScript 6 — isolatedModules transpiles each spec file
    // independently and can no longer infer a common source directory from a single file's path
    // (TS5011). It must point at the actual tsconfig-relative source root (apps/api/src), not
    // jest's own `rootDir` above (which is already relative to this file's directory).
    '^.+\\.(t|j)s$': ['ts-jest', { isolatedModules: true, tsconfig: { rootDir: '.', types: ['jest', 'node'] } }],
  },
  testEnvironment: 'node',
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
};

export default config;
