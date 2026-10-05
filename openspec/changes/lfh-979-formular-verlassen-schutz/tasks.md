# Tasks

## 1. Testgrundlage und Bausteine

- [x] 1.1 `test/utils.tsx`: Option `datenRouter` in `renderMitProviders` (D5) mit `rerender`-tauglichem Kinder-Kontext; belegt durch einen Test, der `useBlocker` mit der Option rendert und nach `rerender` den neuen Inhalt sieht
- [x] 1.2 `components/VerlassenRueckfrage.tsx` aus `EntwurfNavigationSchutz` herauslösen (D1), „Speichern und weiter“ nur mit `speichern`; `EntwurfNavigationSchutz` wird Hülle. Belegt durch einen neuen Test (blockiert bei Pfadwechsel, Bleiben erhält, Verwerfen führt aus, ohne `speichern` kein dritter Knopf) und unverändert grüne Tests von `BefehlDetailPage`
- [x] 1.3 `components/useFormularVerlassenSchutz.ts` (D2) per TDD: Fassungszähler, `aktiv: false` schaltet ab, `beforeunload` nur bei `ungespeichert`, Eingabe während des Speicherns bleibt geschützt, gescheitertes Speichern hält den Merker. Mutationsprobe: `gespeichert` ohne Fassungsvergleich macht den Weitertipp-Test rot

## 2. Organisation (U79)

- [x] 2.1 Rot zuerst: `OrganisationTab.test.tsx` „Name ändern, Leiste Speichern → PATCH enthält `name`, Toast nennt den Namen“ gegen den heutigen Stand rot sehen
- [x] 2.2 `api/organisation.ts`: `aendereOrganisation` (nur übergebene Felder); verwaiste `setzeOrgName`/`setzeOrgDefault` entfernen; belegt durch `pnpm typecheck`
- [x] 2.3 `OrganisationTab` auf ein Formular, einen PATCH, nur geänderte Felder, Toast nach D4, Fehler über der Leiste, Abgleich Server → Feld nur ohne offene Änderung, Verlassen-Schutz eingebunden. Bestehende Tests auf den einen Speicherweg umstellen (Enter im Namen, fremde Umbenennung, Refetch während des Tippens, gescheiterter Refetch, Nicht-Admin); neu: „nichts geändert → kein Aufruf, kein Toast“, „beide Felder → ein PATCH mit beiden“, „genau ein Speichern-Knopf“, Rückfrage beim Verlassen. Test aus 2.1 grün

## 3. Schutz auf den übrigen Formularseiten (U80)

- [x] 3.1 `FahrzeugDetailPage` und `PersonalDetailPage` einbinden; Seitenprobe Fahrzeug: Kennzeichen ändern, Menülink → Rückfrage; nach Speichern keine; Nicht-Admin keine. Tests auf `datenRouter: true`
- [x] 3.2 `EinsatzAllgemein`, `EinsatzVerhalten`, `EinsatzAufbewahrung` einbinden (`aktiv: darfBearbeiten`); Seitenprobe Allgemein: Feld ändern, Reiterwechsel → Rückfrage, „Bleiben“ erhält die Eingabe. Tests der Sektionen und `EinsatzEinstellungenPage.test.tsx` auf `datenRouter: true`; `EinsatzModule` unverändert, belegt durch seinen grünen Test ohne Data Router
- [x] 3.3 `AnzeigeEinstellungen` und `EinsatzDefaults` einbinden; in `EinsatzDefaults` `hatFassung` und eigenen `beforeunload` durch den Hook ersetzen, bestehender `beforeunload`-Test bleibt grün
- [x] 3.4 Übrige Tests, die eine der Seiten rendern (`rechteGate.test.tsx`, ggf. `EinsatzdatenPage.test.tsx`), auf `datenRouter: true`; belegt durch grünen Vitest-Gesamtlauf
- [x] 3.5 Abmelden/Sitzungsende mit offener Änderung prüfen (Risiko in design.md) und das Ergebnis im Test oder in einem Code-Kommentar festhalten

## 4. Regel

- [x] 4.1 `frontend/AGENTS.md` „Formularseiten“ um die Regel aus D6 ergänzen, `frontend/src/entwurf/AGENTS.md` auf den Baustein verweisen; belegt durch den Prettier-Schritt in `check-all.sh`

## 5. Abschluss

- [ ] 5.1 `./scripts/check-all.sh` grün (Umgebungsrot gegen `alpha` gegengeprüft) und Vitest-Gesamtlauf grün
- [ ] 5.2 Mutationsproben dokumentiert: Fix in `OrganisationTab` zurückgenommen → 2.1 rot; Rückfrage abgeklemmt → Seitenproben 3.1/3.2 rot
