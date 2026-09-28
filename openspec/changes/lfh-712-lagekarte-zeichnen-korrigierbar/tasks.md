# Tasks

Arbeitsweise je Aufgabe: `superpowers:test-driven-development` (erst rot, dann grün). Frontend-Befehle
über `mise exec pnpm@11.10.0 -- pnpm -C <absoluter-frontend-pfad> …`.

## 1. Adapter: Undo, Punktstand, Esc-Besitz (`pages/lagekarte/zeichnen.ts`)

- [x] 1.1 Konstruktor mit `undoRedo: { modeLevel: new TerraDrawModeUndoRedo() }` und beiden Modi mit `keyEvents: { cancel: null, finish: 'Enter' }`; `prefixId: praefix` bleibt. Verifikation: `zeichnen.test.ts` prüft beide Optionen am Konstruktor-Aufruf (Mock zeichnet die Argumente auf); Mutationsprobe — jede Option einzeln entfernt färbt mindestens einen Test rot.
- [x] 1.2 Geordnete Punktliste (Array, Pixel-Entdoppelung bleibt) und `onStandAendern({ punkte, kannZurueck })` statt `onBereitschaftAendern`, gemeldet nach Punkt/`starten`/`stoppen`/`finish` und bei `history`, nur bei Wertänderung. Verifikation: Tests „ohne Punkt `kannZurueck` false, nach erstem Punkt true" als Paar; keine Doppelmeldung bei gleichem Stand.
- [x] 1.3 `punktZurueck()` (Riegel `aktiv && draw.enabled` vor `undo()`) und `verwerfen()` (Entwurf löschen, Modus neu setzen, Stand 0). Verifikation: Tests „Undo nimmt genau einen Punkt" (3 → 2, `bereit` fällt), „Undo des letzten Punktes → 0, gesperrt, Modus aktiv", „gestoppt: `punktZurueck` wirft nicht und liefert false", „nach `verwerfen` Stand 0 und `kannZurueck` false".
- [x] 1.4 Aufrufer in `Kartenflaeche.tsx` umstellen: Callback-Prop `onZeichnenStandAenderung`, Handle-Methoden `punktZurueck()` und `zeichnungVerwerfen()` (fragen genau den aktiven Controller). Verifikation: `pnpm exec tsc --noEmit` grün; bestehende Kartenflaeche-/LagekartePage-Tests grün.

## 2. Zeichnen-Steuerung (`ZeichnenSteuerung.tsx`)

- [x] 2.1 Props `punkte`, `punktZurueckMoeglich`, `onPunktZurueck`; Knopf „Letzten Punkt zurück" (antd-`Button`, kein `size`), Zähler „n Punkte" (Mono, `tabular-nums`), Knopfreihe umbrechend. Verifikation: `ZeichnenSteuerung.test.tsx` — gesperrt bei `false`, frei bei `true`, Klick meldet; Zähler-Text; Bestätigungsphase zeigt weder Knopf noch Zähler.
- [x] 2.2 Hinweiszeile nennt beide Esc-Stufen genau einmal („Esc verwirft die Zeichnung, ein zweites Esc beendet das Zeichnen."). Verifikation: Test zählt den Wortlaut genau einmal im Baum (Gegenaussage: nicht im Knopf, nicht doppelt).
- [x] 2.3 `dichte.guard.test.ts` und `aktionsabstand.guard.test.ts` grün (kein neues punktuelles `size`, keine `danger`-Nachbarschaft ohne Abstand).

## 3. Seite: Verdrahtung und zweistufiges Esc (`LagekartePage.tsx`, `useKartenInteraktion.ts`)

- [x] 3.1 `zeichnenBereit` durch den Stand aus 1.2 ersetzen; `bereit` aus `punkte >= mindestPunkte` (Linie 2, Fläche 3) ableiten; Stand an die Steuerung reichen, `onPunktZurueck` → Handle. Verifikation: `LagekartePage.test.tsx` — Stand-Meldung sperrt/entsperrt „Abschließen" und „Letzten Punkt zurück".
- [x] 3.2 Rückkehr aus der Bestätigungsphase in die Zeichenphase als benannte Aktion in `useKartenInteraktion` (Reducer-Fall `zone` mit demselben Entwurf + `zoneZeichnenNonce`, wie im Serienpfad; nichts gespeichert). Verifikation: Hook-Test — nach der Aktion `zoneBestaetigung == null`, `zoneEntwurf` unverändert, Nonce erhöht, kein POST.
- [x] 3.3 `keydown`-Zuhörer an `window`, nur bei aktivem Zeichenmodus, Riegel `defaultPrevented` und Eingabeziele; Stufen nach Design D2 inkl. „Speichern läuft → nichts" und Serie mit Gespeichertem → „Fertig". Quittung `message.info('Zeichnung verworfen')` nur in den Verwerfen-Zweigen. Verifikation: Tests je Zeile der D2-Tabelle; Gegenaussage: Undo des letzten Punktes erzeugt keine Quittung; Messen endet weiter mit einem Esc (Bestandstest bleibt grün).

## 4. Eigenposition

- [x] 4.1 `pages/lagekarte/useEigenposition.ts`: Verfügbarkeit (`isSecureContext`, `navigator.geolocation`), `watchPosition`/`clearWatch` beim Aus- und Unmount, Fehlerfälle schalten aus und melden, keine Persistenz. Verifikation: Vitest mit gestubbtem `navigator.geolocation` und `isSecureContext` — unsicher → keine Anfrage; an → Position; aus → `clearWatch`; Unmount → `clearWatch`; `PERMISSION_DENIED`/`TIMEOUT` → aus + Meldung; `localStorage` bleibt leer.
- [x] 4.2 Knopf in `KartenUeberlagerung.tsx` (optionale Prop, `TbCurrentLocation`, `aria-pressed`; gesperrt als `aria-disabled` + Popover mit Grund + `aria-describedby`). Verifikation: `KartenUeberlagerung.test.tsx` — ohne Prop kein Knopf; unsicher: Knopf `aria-disabled`, Klick zeigt den Grund als Text, `aria-describedby` zeigt auf ihn, kein Umschalten; sicher: Klick schaltet, `aria-pressed` folgt; `queryByRole('img')` im Knopf leer.
- [x] 4.3 Darstellung in `Kartenflaeche.tsx`: GeoJSON-Quelle Punkt + Genauigkeitskreis (Polygon aus Radius in Metern, reine exportierte Funktion), Neuanlage nach `setStyle` über `planeReAnlegenNachStyle`; Seite fliegt beim ersten Fix einmal über `flyToZiel`. Verifikation: Unit-Test der Kreisfunktion (Radius auf ±1 % am Äquator und bei 51° N); Test „erster Fix fliegt, zweiter nicht".
- [x] 4.4 `docs/betrieb/packaging.md`: HTTP-Liste um „keine Eigenposition auf der Lagekarte" ergänzen. Verifikation: Abschnitt „sicherer Kontext" nennt es.

## 5. e2e und Gates

- [ ] 5.1 e2e Lagekarte (neuer Spec `e2e/lagekarte-zeichnen-korrigierbar.spec.ts`): Gefahrengebiet zeichnen, drei Punkte per `page.mouse.click` auf den Canvas (Vorbild `lagekarte-smoke.spec.ts`), „Letzten Punkt zurück" → Zähler „2 Punkte" und Knopf frei; Esc → Zähler „0 Punkte", Quittung sichtbar, Steuerung offen; zweites Esc → Steuerung weg. Verifikation: Spec grün, Fokus beim Esc auf dem Zurück-Knopf (nicht auf dem Canvas) belegt den Besitzwechsel.
- [ ] 5.2 e2e Eigenposition: Kontext mit `geolocation` + `permissions: ['geolocation']`; Einschalten → Knopf gedrückt, Quelle mit Punkt vorhanden, Karte zentriert; Grundlagenwechsel → Punkt bleibt; `page.on('request')` findet die Koordinaten in keiner Anfrage. Verifikation: Spec grün.
- [ ] 5.3 `e2e/fokus-verdeckung.spec.ts` und `e2e/gate3-trefflaeche.spec.ts` mit dem neuen Knopf laufen lassen (390 px Handschuh). Verifikation: beide grün; bricht einer, Spaltenlösung klären statt den Test zu lockern.
- [ ] 5.4 `./scripts/check-all.sh` grün (Fmt/Prettier, Lint `--max-warnings 0`, tsc, Vitest, e2e). Verifikation: Exit 0, Log ohne „ÜBERSPRUNGEN" für e2e.

## 6. Doku und Abschluss

- [ ] 6.1 CLAUDE.md: Absatz „Ein Sprung ist keine Handlung" (LFH-616) — Messen endet mit einem Esc, Zeichnen zweistufig (LFH-712, Entscheidung 28.09.2026); Hinweis auf Esc-Besitz (terra-draw `cancel: null`). Verifikation: `grep -n "einzige Modus, den Escape" CLAUDE.md` liefert nichts mehr.
- [ ] 6.2 Prüfliste Einsatztauglichkeit (15 Kriterien) für die Lagekarte unter `docs/superpowers/specs/2026-09-28-lfh-712-pruefliste.md`, jede Zeile mit Verdikt. Verifikation: keine Zeile „nicht geprüft".
