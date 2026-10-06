# Design

## Context

Voreingestellte Werte gibt es auf drei Ebenen: fest im Code (System), in der Verwaltung für die
ganze Organisation (`/admin/einstellungen/anzeige`, `/admin/einstellungen/einsatz`) und je
Einsatz (`/einsaetze/:id/einstellungen`). Die Anzeige löst in dieser Reihenfolge auf
(`AnzeigeKonventionenContext.tsx`: Einsatz ?? Org ?? `null`, und `null` heißt bei der Zeitzone
Gerätezeit, `anzeige/format.ts`). Der sichtbare Text benennt die Ebenen heute mit „Default“,
„Fallback“, „Standard“ und „Standard (Org)“ durcheinander. Entscheidung 4 der Klärungsrunde
(Ruben, 06.10.2026, Option A) legt „Vorgabe“ fest; Option B („Standard“) ist verworfen.

## Goals / Non-Goals

**Goals:**
- Ein Wort für voreingestellte Werte im ganzen sichtbaren Text, durch einen Guard gehalten.
- Die Herkunft der Vorgabe bleibt lesbar (System oder Organisation).
- Platzhalter nennen den Wert, der bei leerem Feld wirklich gilt.

**Non-Goals:**
- Bezeichner im Code (`DEFAULT_KONVENTIONEN`, `EinsatzDefaults`, `org_defaults`,
  `DefaultModulRedirect`) und Kommentare bleiben. Die Regel gilt dem sichtbaren Text.
- Routen und API-Felder bleiben (`/admin/einstellungen/einsatz`, `standard_modul`).
- Eigennamen mit eigener Spec bleiben: „Standard-Rufname“ und „Standardansicht“ samt
  „Als Standard“ im Ansichtsmenü der Lagekarte. Umbenennen hieße drei Specs und rund 45
  Fundstellen anfassen; das entscheidet Ruben am Checkpoint.
- „Lage-Dashboard“ im Text des Einstiegsmoduls bleibt; die Modulnamen gehören einem anderen
  Paket (Entscheidung 3, „Dashboard“ → „Lagebild“).

## Decisions

**D1 Wortlaut in einer Datei.** `components/vorgabeText.ts` exportiert die Bausteine:
`mitVorgabe(wert)` → „<wert> (Vorgabe)“, `LEER_SYSTEM_VORGABE` → „Leer = Vorgabe des
Systems.“, `orgVorgabe(wert)` → „Vorgabe der Organisation: <wert>“, `KEINE_VORGABE` →
„keine Vorgabe“. Muster ist `stammdaten/rechteText.ts`: eine abweichende Fassung fiele sonst
niemandem auf, weil jede Seite für sich plausibel aussieht. `components/` statt
`pages/einstellungen/`, weil auch Meldungen, Karten und Stammdaten den Wortlaut brauchen.

**D2 Ebene im Text.** Org-Seiten erklären „Leer = Vorgabe des Systems.“ und setzen
„(Vorgabe)“ hinter den System-Wert im Platzhalter. Einsatz-Seiten zeigen unter dem Feld
„Vorgabe der Organisation: <Wert>“ (bisher „Standard (Org): <Wert>“), solange die Organisation
einen Wert gesetzt hat, und im Platzhalter den System-Wert mit „(Vorgabe)“. Verworfen:
„Org-Vorgabe“ als Kürzel; „Org“ ist selbst ein Kürzel und steht schon im Hinweis.

**D3 Zeitzone.** Platzhalter „Gerätezeit (Vorgabe)“, Tooltip „Zeitzone wie Europe/Berlin.
Leer = Gerätezeit.“ an beiden Ebenen. Das Wort „IANA“ entfällt.

**D4 Seitennamen.** „Einsatz-Defaults“ → „Einsatz-Vorgaben“ (Menü und Titel),
„Modul-Rollen-Default“ → „Rollen-Vorgabe je Modul“, „Benötigte Rolle (Default)“ →
„Benötigte Rolle (Vorgabe)“, „Default-Bestätigungsfrist“ → „Vorgabe-Bestätigungsfrist“,
„Standard-Modul (Einstieg)“ → „Einstiegsmodul“, „Login-Wege“ → „Anmeldewege“,
„Basemap-Switcher“ → „Wahl der Kartengrundlage“ (Begriff aus Spec `lagekarte-kartengrundlage`).

**D5 Guard statt Lint-Regel.** `components/vorgabe.guard.test.ts` liest jede `.ts`/`.tsx`
unter `frontend/src` außer Tests, entfernt Kommentare und sucht `\bDefaults?\b`,
`\bFallback\b` und `\bStandard\b`. Groß geschrieben und als ganzes Wort trifft das nur Text:
Bezeichner wie `preventDefault`, `DefaultOptionType`, `fehlerFallback`, `DEFAULT_KONVENTIONEN`
sind keine Wortgrenze oder anders geschrieben. Eigennamen und echte Fremdwörter stehen in
`AUSNAHMEN` mit Grund; ein Eintrag ohne Fund macht den Guard rot (tote Ausnahme), wie bei
`dichte.guard.test.ts`. Eine ESLint-Regel wäre rot geboren (`frontend/AGENTS.md`, Lint-Disziplin).

## Risks / Trade-offs

- [Der Guard sieht Text in Variablen aus anderen Quellen nicht, etwa Server-Meldungen] → Er
  deckt den Code des Frontends ab; Servertexte sind deutsch und nennen keine Vorgaben.
- [Ein künftiges englisches Wort „Standard“ in fachlicher Bedeutung, z. B. „Standard-Tiles“] →
  Ausnahme mit Grund oder umformulieren; die Liste macht jede Ausnahme sichtbar.
- [Parallele Pakete ändern dieselben Dateien, etwa die Modulnamen] → Reine Textänderungen,
  Konflikte sind klein; der Guard fängt einen zurückgemergten Altwortlaut.
