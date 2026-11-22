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
/** Riegel gegen die Formular-Anmeldung; Ausnahmeliste in `frontend/.oxlintrc.json`. */
const E2E_RIEGEL_ANMELDEFORMULAR = [
  {
    selector:
      "CallExpression[callee.property.name='fill'] > MemberExpression > CallExpression[callee.property.name='getByLabel'] > Literal[value='Benutzername']",
    message:
      'In e2e über die API anmelden: `anmeldenPerApi` aus `e2e/anmelde-kern.ts` bzw. `anmelden`/`anmeldenAls` (LLH-1665). Das Formular füllen nur Specs aus, die die Anmeldung selbst prüfen (Liste in `frontend/.oxlintrc.json`).',
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
  },
};
