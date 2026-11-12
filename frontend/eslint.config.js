import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/** Riegel für `e2e/**` (LFH-385, LFH-1114), geteilt mit der Ausnahme für Anmelde-Specs. */
const E2E_RIEGEL = [
  {
    selector:
      "CallExpression[callee.property.name='waitForLoadState'] > Literal[value='networkidle']",
    message:
      'Kein `networkidle` in e2e (LFH-385): der SSE-Strom der Einsatzrouten hält das Netz offen. Auf einen Inhaltsanker warten (`expect(…).toBeVisible()`/`toHaveCount(n)`).',
  },
  {
    selector: "Property[key.name='waitUntil'] > Literal[value='networkidle']",
    message:
      'Kein `waitUntil: networkidle` in e2e (LFH-385): der SSE-Strom der Einsatzrouten hält das Netz offen. Auf einen Inhaltsanker warten.',
  },
  {
    // LFH-1114: ein Klick in den noch einblendenden Dialog ging unter Last verloren.
    selector:
      "CallExpression[callee.property.name='click'] > MemberExpression > CallExpression[callee.property.name='getByRole'] > ObjectExpression > Property[key.name='name'] > Literal[value='Neuer Einsatz']",
    message:
      'Den Dialog „Neuen Einsatz anlegen“ über `einsatzDialogOeffnen`/`einsatzAnlegen` aus `e2e/einsatz-kern.ts` öffnen (LFH-1114): erst der eingeblendete Dialog nimmt Klicks sicher an.',
  },
];

/**
 * LLH-1665 (Spec `e2e-zuschnitt`): angemeldet wird über die API, nicht über das Formular; jede
 * Formular-Anmeldung kostete zwei volle App-Starts. Nur die Specs, die die Anmeldung selbst
 * prüfen, stehen in {@link E2E_ANMELDEFORMULAR_ERLAUBT}.
 */
const E2E_RIEGEL_ANMELDEFORMULAR = {
  selector:
    "CallExpression[callee.property.name='fill'] > MemberExpression > CallExpression[callee.property.name='getByLabel'] > Literal[value='Benutzername']",
  message:
    'In e2e über die API anmelden: `anmeldenPerApi` aus `e2e/anmelde-kern.ts` bzw. `anmelden`/`anmeldenAls` (LLH-1665). Das Formular füllen nur Specs aus, die die Anmeldung selbst prüfen (Liste in `frontend/eslint.config.js`).',
};

/** Specs, die die Anmeldung selbst prüfen (Formular, Kontrast der Anmeldeseite, Tabs, Speicher). */
const E2E_ANMELDEFORMULAR_ERLAUBT = [
  'e2e/rollen-kern.ts', // `anmeldenImFormular` für Specs, die die Anmeldeseite schon offen haben
  'e2e/primaerknopf-kontrast.spec.ts',
  'e2e/fokusring-kontrast.spec.ts',
  'e2e/browserspeicher-gesperrt.spec.ts',
  'e2e/einmalpasswort.spec.ts',
  'e2e/sitzung-mehrere-tabs.spec.ts',
  'e2e/kernfluss.spec.ts', // Smoke des Kernflusses: Anmeldung, Einsatz über den Dialog, ETB live
  'e2e/doku-bilder/**/*.ts', // Bildlauf der Anwenderdoku, kein e2e-Lauf (LFH-1128)
];

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
    // LFH-385: Einsatzrouten halten einen SSE-Strom offen, `networkidle` tritt dort nur unter
    // Glück ein (parallel rot, `--workers=1` grün). Gewartet wird auf das Element, das der Test
    // danach misst.
    files: ['e2e/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...E2E_RIEGEL, E2E_RIEGEL_ANMELDEFORMULAR],
    },
  },
  {
    // Die Specs, die die Anmeldung selbst prüfen, dürfen das Formular ausfüllen (LLH-1665).
    files: E2E_ANMELDEFORMULAR_ERLAUBT,
    rules: {
      'no-restricted-syntax': ['error', ...E2E_RIEGEL],
    },
  },
  {
    // Service-Worker-Zusatz (LFH-1062), von Workbox per `importScripts` geladen.
    files: ['public/**/*.js'],
    languageOptions: {
      globals: {
        self: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        AbortController: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
  },
  {
    files: ['scripts/**/*.{js,mjs}'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly' },
    },
  },
);
