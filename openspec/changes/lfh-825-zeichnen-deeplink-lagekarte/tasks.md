# Tasks

Jede Aufgabe test-first (`superpowers:test-driven-development`): erst den roten Test, dann den Code.

## 1. Deeplink `?zeichnen=` (routing)

- [ ] 1.1 `parseZeichnenAuftrag(wert)` in `frontend/src/routing/deeplinks.ts` mit exhaustivem `Record<ZoneTyp, true>` und Formen `flaeche`/`linie` (D1, D2); Nachweis: Tests in `routing/deeplinks.test.ts` für jeden Zonentyp, `typ:flaeche`, `typ:linie`, leeren Wert, unbekannten Typ, unbekannte Form, überzählige Teile (`a:b:c`) → `null`.
- [ ] 1.2 `lagekartePfad` um `zeichnen?: { typ; form? }` erweitern; Nachweis: Rundlauf-Test `parseZeichnenAuftrag(new URL(lagekartePfad(…)).searchParams.get('zeichnen'))` ergibt den Auftrag, mit und ohne Form.

## 2. Auftrag → Zonen-Entwurf (Lagekarte)

- [ ] 2.1 Vorgabefarbe der freien Skizze als benannte Konstante neben `ZONE_TYPEN` (`pages/lagekarte/zonenStil.ts`), `Sidebar.tsx` nutzt sie an beiden Knöpfen; Nachweis: bestehende Sidebar-Tests grün, `grep "'#1677ff'" frontend/src/pages/lagekarte/Sidebar.tsx` leer.
- [ ] 2.2 Reine Funktion `zeichenAuftragZuEntwurf(auftrag)` in `pages/lagekarte/` (D2): Geometrie aus `ZONE_TYPEN`, `beides` ohne Form → Fläche mit Vorgabefarbe, feste Geometrie mit abweichender Form → `null`, Typ ohne Eintrag in `ZONE_TYPEN` → `null`; Nachweis: Tabellentest über alle Einträge von `ZONE_TYPEN` plus die Fehlfälle.
- [ ] 2.3 Effekt in `pages/LagekartePage.tsx` liest `searchParams.get('zeichnen')` als Literal, wartet auf `ladt`, startet bei `darfSchreiben` per `onZoneZeichnenStart`, räumt immer (D3); Nachweis: Seitentest (Muster der bestehenden Platzier-Deeplink-Tests) für Start mit Schreibrecht, kein Start ohne Schreibrecht, ungültiger Auftrag, Warten während `ladt`; jeweils Parameter danach weg.
- [ ] 2.4 e2e: `frontend/e2e/lagekarte-zeichnen-korrigierbar.spec.ts` (oder eigener Spec im selben Muster) öffnet `…/lagekarte?zeichnen=gefahrengebiet`, sieht die Zeichnen-Steuerung, die URL ohne Parameter, und ein Esc ohne Punkt beendet den Modus; Nachweis: Spec läuft grün.
- [ ] 2.5 `frontend/src/pages/lagekarte/AGENTS.md`, Abschnitt „Zeichnen und Messen“: eine Zeile zum Zeichnen-Deeplink (Literal-Leser, anwenden-dann-räumen, Vorgabefarbe an einer Stelle); Nachweis: Prettier-Check über `frontend/` grün.

## 3. Schnellaktion und Guard (Sprungpalette)

- [ ] 3.1 `SCHNELLAKTIONEN` in `command-palette/befehle.ts`: Feld `parameter` an jedem Eintrag (`'neu'`), optionale `kennung`, Befehls-Id `aktion:<kennung ?? modulKey>` (D4); Nachweis: `befehle.test.ts` mit unverändertem Id-Pin der bestehenden Zeilen grün.
- [ ] 3.2 Guard: `command-palette/schnellaktionen.guard.test.ts` nach D5 (Scanner über den Parameternamen, Ziel und Deckung je deklariertem Parameter, Selbstbeweis um `zeichnen` erweitert, `neu`-Leser zählt nicht als `zeichnen`-Leser); Nachweis: Guard grün über den bestehenden Einträgen, mit dem Feld `parameter` aus 3.1; Mutationsprobe: `parameter` eines Bestandseintrags auf `zeichnen` gesetzt → Guard rot.
- [ ] 3.3 Neuer Eintrag „Gefahrengebiet zeichnen“ am Ende (Träger `lagekarte`, `parameter: 'zeichnen'`, Kennung `lagekarte-gefahrengebiet`); Kommentar „GEFAHREN FEHLEN BEWUSST (LFH-506)“ durch einen Verweis auf LFH-825 ersetzen; Nachweis: `befehle.test.ts` — Pin um die neue Id am Ende erweitert, Ziel `/einsaetze/5/lagekarte?zeichnen=gefahrengebiet`, fehlt ohne Schreibrecht, fehlt bei nicht freigegebener Lagekarte, erscheint bei nicht freigegebenem Modul `gefahrenzonen`; Guard aus 3.2 grün mit Leser aus 2.3; Mutationsprobe: Leser in `LagekartePage.tsx` hinter eine Konstante gezogen → Guard rot.
- [ ] 3.4 `frontend/src/command-palette/AGENTS.md`: Regel „Schnellaktionen“ (Ziel unter dem Modulpfad des Trägers, deklarierter Leseparameter `neu`/`zeichnen`, Deckung durch den Guard); Nachweis: Prettier-Check über `frontend/` grün.

## 4. Integration

- [ ] 4.1 `./scripts/check-all.sh` grün (oder für Kästchen, die erst die CI des PRs belegt, mit Verweis auf diesen Lauf abhaken).
