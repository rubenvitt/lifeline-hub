import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'playwright-report',
      'node_modules',
      'vite.config.js',
      'vite.config.d.ts',
      '*.tsbuildinfo',
      // LFH-120: aus Rust generiert (openapi-typescript), nicht von Hand gepflegt.
      'src/api/types.generated.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    // eslint-plugin-react-hooks 7 schaltet in `configs.recommended` zusätzlich die
    // React-Compiler-Regeln scharf (purity, immutability, set-state-in-effect …).
    // Wir erzwingen bewusst nur das bisherige Set, damit dieses Toolchain-Upgrade
    // das Lint-Gate nicht verändert; die neuen Regeln sind eine eigene Entscheidung.
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // LFH-288: `Select` nur über den projektweiten Wrapper (components/Select) importieren,
      // damit neue Selects automatisch Combobox-Suche (Tippen-zum-Filtern) bekommen. Der Wrapper
      // selbst darf antd direkt importieren (zeilengenaues eslint-disable dort).
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'antd',
              importNames: ['Select'],
              message:
                "Select über den Wrapper importieren: import { Select } from '…/components/Select' — er schaltet die Combobox-Suche standardmäßig an (LFH-288).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ['scripts/**/*.{js,mjs}'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly' },
    },
  },
);
