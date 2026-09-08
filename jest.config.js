/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.test.ts'],
  // ejemplo/ contiene defectos a proposito: es el material que Vigia analiza
  // en la demo, no una suite que deba ejecutarse.
  testPathIgnorePatterns: ['/node_modules/', '/ejemplo/'],
  collectCoverageFrom: ['src/**/*.ts', '!**/*.test.ts', '!src/cli.ts', '!src/index.ts'],
  coverageThreshold: {
    global: { branches: 80, functions: 90, lines: 90, statements: 90 },
  },
};
