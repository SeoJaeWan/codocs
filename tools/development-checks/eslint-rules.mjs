import domainValueRule from './domain-value-rule.mjs';

/** 내부 ESLint 규칙 플러그인이다. @type {import('eslint').ESLint.Plugin} */
const plugin = {
  rules: {
    'no-raw-domain-value': domainValueRule,
  },
};

export default plugin;
