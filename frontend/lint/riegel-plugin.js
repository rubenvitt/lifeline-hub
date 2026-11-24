/**
 * oxlint-Plugin `lfh`: die e2e-Riegel (LLH-2020, früher `no-restricted-syntax` in ESLint).
 * Visitor-Schlüssel sind esquery-Selektoren wie bei ESLint. Die JS-Plugin-API von oxlint ist
 * Alpha; `riegel-plugin.test.ts` lintet Musterdateien und wird rot, wenn ein Update die Selektoren
 * bricht. Eingeschaltet für `e2e/**` in `frontend/.oxlintrc.json`, dort auch die Ausnahmeliste.
 *
 * - LFH-385: Einsatzrouten halten einen SSE-Strom offen, `networkidle` tritt dort nur unter Glück
 *   ein (parallel rot, `--workers=1` grün). Gewartet wird auf das Element, das der Test danach misst.
 * - LFH-1114: ein Klick in den noch einblendenden Dialog „Neuen Einsatz anlegen“ ging unter Last
 *   verloren.
 * - LLH-2067: antds Einblend-Klassen kennt nur `e2e/dialog-kern.ts`. Die kopierte seitenweite
 *   Warte-Zeile (`.ant-zoom-appear, .ant-zoom-enter`) übersah Popconfirm und Popover
 *   (`ant-zoom-big-appear`) und wartete auf die ganze Seite statt auf den Dialog.
 * - LLH-2090: eine feste Wartezeit (`waitForTimeout`) ist auf einem schnellen Rechner zu lang und
 *   auf einem vollen Runner zu kurz; so entstehen Tests, die nur im Wiederholversuch grün werden.
 *   Gewartet wird auf einen Zustand. Der Bestand steht in der Ausnahmeliste.
 * - LLH-1665 (Spec `e2e-zuschnitt`): angemeldet wird über die API, nicht über das Formular; jede
 *   Formular-Anmeldung kostete zwei volle App-Starts.
 */

/** Riegel für alle Dateien unter `e2e/`. */
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
    selector:
      "CallExpression[callee.property.name='click'] > MemberExpression > CallExpression[callee.property.name='getByRole'] > ObjectExpression > Property[key.name='name'] > Literal[value='Neuer Einsatz']",
    message:
      'Den Dialog „Neuen Einsatz anlegen“ über `einsatzDialogOeffnen`/`einsatzAnlegen` aus `e2e/einsatz-kern.ts` öffnen (LFH-1114): erst der eingeblendete Dialog nimmt Klicks sicher an.',
  },
];
const E2E_RIEGEL_EINBLENDUNG_MELDUNG =
  'Nicht selbst auf antds Einblend-Klassen warten (LLH-2067): `dialogSteht(page, name)` bzw. `eingeblendet(locator)` aus `e2e/dialog-kern.ts` (frontend/e2e/AGENTS.md, „Erst klicken, wenn der Dialog steht“).';

/** Riegel gegen eigenes Warten auf Einblend-Klassen; Ausnahmen in `frontend/.oxlintrc.json`. */
const E2E_RIEGEL_EINBLENDUNG = [
  { selector: 'Literal[value=/ant-zoom/]', message: E2E_RIEGEL_EINBLENDUNG_MELDUNG },
  { selector: 'Literal[regex.pattern=/ant-zoom/]', message: E2E_RIEGEL_EINBLENDUNG_MELDUNG },
];

/** Riegel gegen die Formular-Anmeldung; Ausnahmeliste in `frontend/.oxlintrc.json`. */
const E2E_RIEGEL_ANMELDEFORMULAR = [
  {
    selector:
      "CallExpression[callee.property.name='fill'] > MemberExpression > CallExpression[callee.property.name='getByLabel'] > Literal[value='Benutzername']",
    message:
      'In e2e über die API anmelden: `anmeldenPerApi` aus `e2e/anmelde-kern.ts` bzw. `anmelden`/`anmeldenAls` (LLH-1665). Das Formular füllen nur Specs aus, die die Anmeldung selbst prüfen (Liste in `frontend/.oxlintrc.json`).',
  },
];

/** Riegel gegen feste Wartezeiten (LLH-2090); Bestand in `frontend/.oxlintrc.json`. */
const E2E_RIEGEL_WARTEZEIT = [
  {
    selector: "CallExpression[callee.property.name='waitForTimeout']",
    message:
      'Keine feste Wartezeit in e2e (LLH-2090, frontend/e2e/AGENTS.md, „Warten auf einen Zustand“): auf einen Zustand warten (`expect(…).toBeVisible()`, `expect.poll`, `toPass`). Ist das Abwarten selbst der Prüfgegenstand (Doppeltipp-Fenster, „bleibt stehen“), mit `// oxlint-disable-next-line lfh/e2e-wartezeit -- <Grund>` begründen.',
  },
];

/** Eine Regel, die jeden Treffer eines der Selektoren mit seiner Meldung meldet. */
const riegel = (eintraege) => ({
  meta: { type: 'problem' },
  create(context) {
    const visitor = {};
    for (const { selector, message } of eintraege)
      visitor[selector] = (node) => context.report({ node, message });
    return visitor;
  },
});

export default {
  meta: { name: 'lfh' },
  rules: {
    'e2e-riegel': riegel(E2E_RIEGEL),
    'e2e-anmeldeformular': riegel(E2E_RIEGEL_ANMELDEFORMULAR),
    'e2e-einblendung': riegel(E2E_RIEGEL_EINBLENDUNG),
    'e2e-wartezeit': riegel(E2E_RIEGEL_WARTEZEIT),
  },
};
