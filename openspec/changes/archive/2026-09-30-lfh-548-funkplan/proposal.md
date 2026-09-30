# Proposal

## Why

FwDV 100 (Anlage 5, S. 66) verlangt ab Führungsstufe B einen tabellarischen Funkplan mit
Dienststellen, Rufnamen, Kanälen und Gegenstellen. Er ist das fachlich stärkste Arbeitsergebnis des
Sachgebiets S6. Die Stab-Spec LFH-46 hat ihn bewusst aus v1 herausgenommen (Abschnitt 13.1), weil er
eine eigene Fläche ist. Die Daten liegen vollständig im Bestand: Abschnitte, Einheiten und Fahrzeuge
mit Rufname und OPTA, dazu Sprechgruppen (TMO/DMO), Kommunikationsmittel und Erreichbarkeit
(Migrationen 0047, 0073, 0086). Heute muss S6 den Plan trotzdem von Hand abschreiben.

Ein zweiter Anlass: „In Lagebericht übernehmen“ im Meldebild legt den Bericht erst an und füllt ihn
dann in einem zweiten Aufruf. Scheitert der zweite, bleibt ohne Hinweis ein leerer Entwurf stehen.
Der Funkplan braucht dieselbe Übernahme. Der User hat am 30.09.2026 entschieden, sie atomar zu
bauen und das Meldebild im selben Zug umzustellen.

## What Changes

- **Neue Seite „Funkplan“** unter `/einsaetze/:id/stab/funkplan`. Einstieg ist die S6-Zeile der
  Stabseite. Die Seite ist schreibgeschützt und wird allein aus vorhandenen Listen abgeleitet: keine
  neue Tabelle, keine Migration, kein eigener Lese-Endpunkt.
  - Die Tabelle ist ein Baum: Abschnitt (samt Unterabschnitten) → Einheit (samt Untereinheiten) →
    Fahrzeug. Fahrzeuge ohne Einheit und Einheiten ohne Abschnitt stehen in einem Sammelknoten.
  - Spalten: Stelle (fixiert, menschenlesbar), Rufname/OPTA, Leiter/Führer, TMO-Sprechgruppen,
    DMO-Sprechgruppen, Kommunikationsmittel und Erreichbarkeit.
  - Jede Zeile führt per Deeplink dorthin, wo sie bearbeitet wird: zum Abschnitt, zur Einheit
    oder zum Fahrzeug.
- **Lücken oberhalb der Tabelle**, als Zahl mit Deeplink:
  - Abschnitte ohne Sprechgruppe
  - Einheiten ohne Sprechgruppe
  - Einheiten ohne Erreichbarkeit
  - einsatzlokale Sprechgruppen ohne Zuordnung
  - dazu der feste Hinweis, dass die eigene Gegenstelle (Führungsstelle/ELW) nicht erfasst ist.
  Ist eine Liste gesperrt oder nicht geladen, steht dort „—“ mit Grund, nie „0“.
- **Fahrzeugführer** in der Fahrzeugzeile, abgeleitet aus dem Einsatzpersonal (Position „Führer“).
  Das gilt nur, wenn das Modul Personal lesbar ist. Sonst steht dort „—“ mit Grund.
- **Erreichbarkeit** ist personenbezogen. Am Bildschirm erscheint sie erst ab `xl`, im Druck immer,
  im Lagebericht nie.
- **Aktionen:** „Drucken / als PDF“ über die bestehende Druckmechanik mit eigenem Druckkopf, und
  „In Lagebericht übernehmen“ als Freitext-Bericht „Funkplan <DTG>“.
- **Atomare Übernahme:** `POST …/lageberichte` und `POST …/befehle` nehmen optional `abschnitte`
  als Startinhalt. Geprüft wird wie beim PATCH, geschrieben wird in einer Transaktion. Das Meldebild
  stellt auf diesen einen Aufruf um. Ein Fehler steht künftig an der Seite, nicht mehr als Toast.
- **Folgeticket** für das fehlende Feld der eigenen Gegenstelle am Einsatz.

## Capabilities

### New Capabilities

- `stab-funkplan`: Der abgeleitete Funkplan des Sachgebiets S6. Er regelt Zeilen, Spalten, Lücken,
  Rechteweiche, Datenschutz der Erreichbarkeit, Druck, Übernahme in den Lagebericht und Einstieg.
- `dokument-uebernahme`: Ein Lagebericht oder Befehl kann mit Startinhalt angelegt werden, in einem
  Schritt und ohne leeren Entwurf. Darauf stützen sich die Übernahmen aus Funkplan und Meldebild.

### Modified Capabilities

_keine_. Die Anforderungen in `druck-dokumente` gelten für jedes Druckstück, also auch für den
Funkplan. Dort ändert sich keine Anforderung.

## Impact

- **Backend:** `src/routes/vorlagendokument.rs` (`AnlegenBody` generisch über den Abschnittstyp,
  Prüfung wie in `aktualisieren`), `src/vorlagendokument/repo.rs` (Anlegen mit Startinhalt in einer
  Transaktion). Lagebericht- und Befehlsrouten reichen das nur durch. Tests unter `tests/`.
- **Frontend, neu:**
  - `pages/FunkplanPage.tsx`
  - `stab/funkplan.ts` (Baum, Markdown)
  - `stab/luecken.ts` (Lückenfilter, auch für ST6 gedacht)
  - Druck-CSS
  - Deeplink-Bauer `funkplanPfad`
- **Frontend, geändert:**
  - Route in `App.tsx`
  - Einstieg in `pages/StabPage.tsx`
  - `components/FunkErreichbarkeit.tsx` (Label-Helfer exportiert)
  - `api/lageberichte.ts` und `api/befehle.ts` (Startinhalt)
  - `pages/KraefteuebersichtPage.tsx` (Übernahme in einem Aufruf)
  - `datensicht.guard.test.ts` (`KONSUMENTEN`, `NUR_TABELLE`)
- **e2e:**
  - Breitenmessung vor dem Bau bei 1366 px mit offenem Panel
  - Funkplan-Route in Gate 1
  - Druckpfad des Funkplans
- **Keine** Migration, keine Änderung an Rechten oder Modulfreigaben, kein neuer Live-Event.
