// ESLint v9+ config file
import next from 'eslint-config-next';

export default [
  ...next({
    extends: ['next/core-web-vitals', 'next/typescript'],
  }),
]; 