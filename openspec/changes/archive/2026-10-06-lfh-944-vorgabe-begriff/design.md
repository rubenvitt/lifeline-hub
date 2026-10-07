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
- Modulnamen bleiben (Entscheidung 3, „Dashboard“ → „Lagebild“, eigenes Paket). Der Platzhalter
  des Einstiegsmoduls nennt das Modul aus `redirectZiel()` mit seinem Registry-Label, statt einen
  Namen fest zu schreiben.

## Decisions

**D1 Wortlaut in einer Datei.** `components/vorgabeText.ts` exportiert die Bausteine:
`mitVorgabe(wert)` → „<wert> (Vorgabe)“, `orgVorgabe(wert)` → „Vorgabe der Organisation:
<wert>“. Ein Baustein „keine
Vorgabe“ entfiel bei der Umsetzung: wo leer keine Frist gilt, sagt der Platzhalter das
(„keine Frist (Vorgabe)“). Muster ist `stammdaten/rechteText.ts`: eine abweichende Fassung fiele sonst
niemandem auf, weil jede Seite für sich plausibel aussieht. `components/` statt
`pages/einstellungen/`, weil auch Meldungen, Karten und Stammdaten den Wortlaut brauchen.

**D2 Ebene im Text.** Org-Seiten setzen „(Vorgabe)“ hinter den System-Wert im Platzhalter. Ein
Satz „Leer = Vorgabe des Systems.“ stand im ersten Stand dabei; er entfiel beim Nachziehen von
alpha, weil die Bedien-Leitlinie „Text erklärt nie die Bedienung“ (LFH-1078) solche Sätze
verbietet und der Platzhalter dasselbe sagt. Einsatz-Seiten zeigen unter dem Feld
„Vorgabe der Organisation: <Wert>“ (bisher „Standard (Org): <Wert>“), solange die Organisation
einen Wert gesetzt hat. Ihr Platzhalter nennt den Wert, der leer wirklich gilt: die Vorgabe der
Organisation, ohne sie die des Systems (`platzhalterVorgabe` in `einsatzEinstellungenForm.ts`).
Der erste Entwurf setzte auch im Einsatz immer den System-Wert; das Review fand den Widerspruch
zu Requirement 3 („5 (Vorgabe)“ über „Vorgabe der Organisation: 30 Min.“). Verworfen:
„Org-Vorgabe“ als Kürzel; „Org“ ist selbst ein Kürzel und steht schon im Hinweis.

**D3 Zeitzone.** Platzhalter „Gerätezeit (Vorgabe)“ in der Verwaltung, im Einsatz nach D2;
Tooltip in beiden „Zeitzone wie Europe/Berlin.“ Was leer gilt, sagt nur der Platzhalter (siehe D2).
Das Wort „IANA“ entfällt.

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
  deckt den Code des Frontends ab. Die eine Servermeldung mit „Default“ (Fristprüfung der
  Einstellungen) sagt jetzt „Frist muss zwischen 1 und 10080 Minuten liegen“.
- [Zusammengesetzte Wörter wie „Standardumfang“ (Spec `einsatzbericht`) fallen nicht unter das
  Muster] → Bewusst: dort ist es ein benannter Umfang mit eigener Spec, keine Feld-Vorgabe.
- [Ein künftiges englisches Wort „Standard“ in fachlicher Bedeutung, z. B. „Standard-Tiles“] →
  Ausnahme mit Grund oder umformulieren; die Liste macht jede Ausnahme sichtbar.
- [Parallele Pakete ändern dieselben Dateien, etwa die Modulnamen] → Reine Textänderungen,
  Konflikte sind klein; der Guard fängt einen zurückgemergten Altwortlaut.
