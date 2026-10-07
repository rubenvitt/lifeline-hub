# Proposal

## Why

Im Führungskraftwagen ist das ETB die wichtigste Leseansicht. In der kompakten Dichte belegt ein
einzeiliger Eintrag heute 84 bis 106 px, weil rechts Verfasser, Meldeweg und Menüknopf
untereinander stehen und der Verfasser am 15ch-Deckel umbricht. Bei 1440×900 sind so nur 5 bis 7
Einträge sichtbar. Dazu sind drei Viertel der Einträge Systemeinträge (Personenerfassung,
Sichtung, FMS), die sich nicht ausblenden lassen; wer nur Meldung, Anordnung und Entscheidung im
Zusammenhang lesen will, sucht sie aus Protokollzeilen heraus.

## What Changes

- **Kompakte Zeile:** In der kompakten Dichte stehen Verfasser (mit Funktion) und Meldeweg in der
  Metazeile neben Typwort und Von→An, einzeilig mit Ellipse, Volltext im `title`. Das ⋮-Menü steht
  in der Kopfzeile rechts neben Typwort und Meta statt unter dem Verfasser. Komfortabel und
  Handschuh behalten die senkrechte Spalte und die 48/72-px-Trefffläche.
- **Gilt für alle Verwender der Zeile, das Menü nur, wo es eines ist:** Verfasser und Meldeweg
  wandern bei allen Zeitachsen in die Metazeile. Der Kopfplatz ist für ein Menü reserviert
  (neue Eigenschaft `menue`); Text-Knöpfe wie „Zurücknehmen“ oder „Streichen“ bleiben rechts.
- **Systemeinträge ausblendbar:** Neuer Listen- und Zählparameter `ohne_system=true` an
  `GET …/etb`, `…/etb/zaehler`, `…/etb/anzahl`. Er schließt Einträge vom Typ `system` aus, über
  dieselbe Filterbedingung wie alle anderen Merkmale. `typ=system` zusammen mit `ohne_system`
  weist der Server mit 422 ab.
- **Schalter „Systemeinträge zeigen“** in der Filterleiste (Vorgabe an), Zustand in der URL wie
  der Typfilter, mit der Zahl der ausgeblendeten Einträge. Kopf und Bilanz zählen dann „n Treffer“
  bzw. „Bilanz im Filter“ über denselben Filter. Druck übernimmt den Filter.
- **Sprung auf einen Systemeintrag bei aktivem Ausschluss:** Findet `?eintrag=` sein Ziel nicht,
  solange Systemeinträge ausgeblendet sind, hebt die Seite den Ausschluss auf und sucht erneut;
  ein Hinweis sagt das.
- Ohne den Parameter verhalten sich API und Oberfläche wie bisher.

## Capabilities

### New Capabilities

- `etb-zeitachse-darstellung`: Aufbau einer Zeitachsenzeile je Dichtestufe (Metazeile, Menü in
  der Kopfzeile, Verfasser einzeilig) und der Schalter für Systemeinträge in der ETB-Oberfläche.

### Modified Capabilities

- `etb-zaehler`: Die Zählung folgt auch dem neuen Ausschluss `ohne_system`; die Kombination mit
  `typ=system` wird abgewiesen.

## Impact

- Backend: `src/routes/etb.rs` (`EtbAbfrageParams.ohne_system`, `filter_merkmale`), `src/etb/repo.rs`
  (`EtbZaehlFilter`, `filter_bedingung`, `EtbFilter::merkmale`), `tests/etb_zaehler.rs`. Kein
  DTO, kein Codegen, keine Migration.
- Frontend: `components/instrument/Zeitachseneintrag.tsx` (+ Test), `etb/EtbZeitachse.tsx`
  (Menü über `menue`), `api/etb.ts`, `routing/deeplinks.ts`, `etb/zeitachseModell.ts`,
  `pages/EtbPage.tsx`, `etb/druckAuswahl.ts`; Gegenprüfung der übrigen Verwender
  (Archivakte, Infotelefon, Lagemeldungen, Überblick, Meldeverlauf, Kräfte, Verpflegung,
  Lage-Dashboard).
- e2e: neues Gate für die Zeilenhöhe (1440×900, 1366×768, auch als Beobachter);
  `etb-chronologie`, `leisten-flaeche`, `gate3-trefflaeche` bleiben grün.
- Regel in `frontend/src/etb/AGENTS.md` (Ausschluss über denselben Filter, Kopfplatz für Menüs).
