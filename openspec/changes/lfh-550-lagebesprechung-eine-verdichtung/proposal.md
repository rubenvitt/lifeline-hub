# Proposal

## Why

Die Stab-Spec LFH-46 (§13 Punkt 4) macht „eine Verdichtung, EINE Quelle“ zur Vorbedingung jeder
Vorbereitung der Lagebesprechung (FwDV 100 Anl. 2: S2 bereitet vor). Der Bestand erfüllt sie
nicht: Dieselbe Zahl hat heute zwei bis drei Rechenwege, und einige liefern schon
unterschiedliche Ergebnisse.
- **Aufträge überfällig:** Das Dashboard zählt auch vollzogene Aufträge. Überblick und Modulzähler
  zählen nur offene.
- **Meldungen überfällig:** Das Dashboard lässt eskalierte unbestätigte Meldungen weg. Modulzähler
  und Warnsperre zählen sie mit.
- **Stärke eines Abschnitts:** Eine unterstellte Einheit im selben Abschnitt zählt doppelt. Sie
  steckt in der kumulierten Stärke der übergeordneten Einheit und wird noch einmal selbst
  summiert.

Wer die Besprechung aus diesen Zahlen vorbereitet, trägt zwei Wahrheiten vor.

Entscheidung am 30.09.2026: **Eine Heimat je Zahl.** Es kommt kein neuer Lagebild-Endpunkt. Was
der Server schon zählt, zählt nur noch er. Was nur der Client zählen kann (die gefilterte
Kräfteübersicht), rechnet genau eine Funktion. Die Vorbereitung setzt auf dieser Quelle auf und
kommt in derselben Change.

## What Changes

- **Handlungsmengen nur vom Server.** Der Führungsstand des Lage-Dashboards und die Kennzahl
  „Offene Aufträge“ des Führungsüberblicks lesen Aufträge offen/in Arbeit/überfällig und
  Meldungen offen/neu/Bestätigung überfällig aus dem Modulzähler. Eigene Zählungen über die
  Listen entfallen.
  - Sichtbare Folgen: Ein vollzogener Auftrag zählt nicht mehr als „überfällig“. Eine eskalierte
    unbestätigte Meldung zählt jetzt mit.
- **Modulzähler um `auftraege.in_arbeit` erweitert.** Das ist additiv; der Überblick braucht es
  für „davon in Arbeit“.
- **Stärke ohne Doppelzählung.** Eine Summe über Einheiten zählt jede Einheit höchstens einmal.
  Die Abschnittsstärke folgt der Unterstellung wie das Meldebild. Sichtbar wird das auf der Seite
  Einsatzabschnitte und in der Abschnittsvorschau, wenn eine unterstellte Einheit im selben
  Abschnitt steht.
- **Doppelte Rechenwege ohne Abweichung werden zusammengelegt:**
  - eine `staerkeText`-Formatierung statt zwei;
  - eine SK-Verteilung statt zwei (Lage-Dashboard und Betroffenen-Seitenleiste).
- **Ein gemeinsames Fixture für Rust und Vitest** pinnt jede Regel, die beide Sprachen kennen
  (offen/überfällig bei Aufträgen, Bestätigung überfällig bei Meldungen, kumulierte Stärke). Das
  ist das Akzeptanzkriterium von LFH-550 und der erste Fall dieser Art im Repo.
- **Neu: „Lagebesprechung vorbereiten“ auf der Stab-Seite.** Ein eigenes Paneel zeigt den
  Lagestand zur nächsten Besprechung. Jede Zeile nennt ihre Quelle, fehlende Rechte werden je
  Quelle benannt. Die Zahlen kommen aus denselben Funktionen wie das Lage-Dashboard, das Paneel
  rechnet keine eigene Zahl. „In Lagebericht übernehmen“ legt in EINEM Aufruf einen
  Freitext-Lagebericht mit diesem Stand an.
  - Die Zahlen werden nicht eingefroren und nicht gespeichert.
  - Es gibt kein Vortragsschema als Datenmodell.

## Capabilities

### New Capabilities
- `lage-verdichtung`: Jede Lagezahl (Handlungsmengen, Stärke, Sichtung, Warnstufe) hat genau eine
  Heimat. Lage-Dashboard, Führungsüberblick und Stab zeigen für dieselbe Zahl denselben Wert.
  Regeln, die Server und Client beide kennen, stehen in einem gemeinsamen Fixture.
- `lagebesprechung-vorbereitung`: Paneel „Vorbereitung“ auf der Stab-Seite (S2). Es enthält den
  Lagestand mit Quellenkennzeichnung, eine Rechteweiche je Quelle und „In Lagebericht übernehmen“
  in einem Aufruf. Es friert nichts ein und hat kein Vortragsschema.

### Modified Capabilities
- `modul-zaehler`: Die Tabelle „Modulzähler mit festgelegter Bedeutung“ bekommt
  `auftraege.in_arbeit` (davon mit Bearbeitungsstatus „in Arbeit“).

## Impact

- **Backend:**
  - `src/einsatz/zaehler.rs`: Feld `in_arbeit`. Die Zählregeln für Aufträge und Meldungen werden
    als reine Funktionen herausgelöst, damit das Fixture sie trifft.
  - `src/einheit/repo.rs`: Die kumulierte Stärke wird als reine Funktion testbar.
  - Codegen: `openapi.json`, `types.generated.ts`.
- **Frontend:**
  - `pages/lage-dashboard/` (Führungsstand, `lagebild.ts`, Abfragen als Hook für Dashboard und
    Stab);
  - `pages/fuehrung/ueberblickDaten.ts` und `UeberblickPage.tsx`;
  - `anzeige/staerke.ts`, `pages/einsatzabschnitte/abschnittStaerke.ts`,
    `bereitstellungsraum/BrDetailPage.tsx`;
  - `kraefte/kraeftebild.ts` (`staerkeText`);
  - `pages/lage-dashboard/lageVerdichtung.ts` und `personen/personenBilanz.ts`;
  - `meldungen/meldungKennzahlen.ts`;
  - `pages/StabPage.tsx` mit dem neuen Baustein `stab/Vorbereitung*`.
- **Tests:** Das gemeinsame Fixture liegt unter `tests/fixtures/verdichtung/`. Es wird von einem
  Rust-Test und von Vitest gelesen.
- **Offline (LFH-723):** Der Modulzähler steht schon in `LAGEBILD_OFFLINE`. Es kommt kein neuer
  Prefix hinzu.
- **Doku:** Eine Regelzeile „Eine Heimat je Zahl“ in `CLAUDE.md`.
- **Unverändert:** API-Pfade, Migrationen, das Abschließen der Lagebesprechung.
- **Nicht betroffen:** Der eingefrorene Archivteil `docs/superpowers/`.
