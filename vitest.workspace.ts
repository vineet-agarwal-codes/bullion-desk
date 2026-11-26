import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      name: 'unit',
      include: ['packages/*/src/**/*.unit.test.ts', 'apps/*/src/**/*.unit.test.ts'],
      environment: 'node',
    },
  },
  {
    test: {
      name: 'integration',
      include: ['apps/*/src/**/*.int.test.ts'],
      environment: 'node',
    },
  },
  {
    test: {
      name: 'contract',
      include: ['apps/*/src/**/*.contract.test.ts', 'packages/*/src/**/*.contract.test.ts'],
      environment: 'node',
    },
  },
]);
