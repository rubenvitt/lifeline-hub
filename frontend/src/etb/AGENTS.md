# ETB — Regeln

Gilt für `frontend/src/etb/`, `pages/EtbPage.tsx`, `pages/EtbDruckPage.tsx`,
`pages/LagemeldungenPage.tsx`, ergänzt `frontend/AGENTS.md`. Pfade relativ zu `frontend/src/`.

**ETB: ein Tagebuch wird gelesen — auf allen Breiten eine Zeitachse** (`etb/EtbZeitachse.tsx`,
Ableitungen in `etb/zeitachseModell.ts`)

- Keine Sortierung/Spaltenfilter/-auswahl; Ordnung = Zeit (Server). Ebenso Lagemeldungen
  (`pages/LagemeldungenPage.tsx`, Tagesgrenze in der Anzeigezone, `lagemeldungen/zeitachse.ts`).
  `KARTEN_EIGENBAU` ist leer (`datensicht.guard.test.ts` pinnt 0).
- Seitenleiste „Bilanz" (`etb/EtbBilanz.tsx`); unter `xl` erst nach der ersten Liste, dann
  stehend (Riegel `bilanzFrei`, nicht `isLoading`).
- **Erfassung** hängt auf jeder Breite als `fuss` an der Wurzel von `EinsatzSeite`
  (`.etb-erfassung-sticky`; ≤ 50 % Fensterhöhe, oben voll sichtbar — `e2e/leisten-flaeche.spec.ts`,
  `fokus-verdeckung.spec.ts`). Fokusabstand per `scroll-margin-block-end`
  (`--lfh-etb-fokusabstand`, `components/fokusabstandUnten.ts`), **nicht** `scroll-padding`.
  Unter `md`: Feld eigene Zeile (`Schnellerfassungszeile gestapelt`, im DOM zuerst), Feldzeile
  rollt waagerecht, „Werte behalten" in der Hinweiszeile, Kurzplatzhalter, Fokus per
  `preventScroll` (`MetaChip`, nicht `autoFocus`).
- **Kopfzahl und Bilanz zählt der Server über DENSELBEN Filter** (LFH-612, `GET …/etb/zaehler`,
  `etb/repo.rs:filter_bedingung`, Parameter nur über `routes/etb.rs:filter_merkmale`; Parität
  `tests/etb_zaehler.rs`). „412 Einträge"/„Bilanz" bzw. „7 Treffer"/„Bilanz im Filter"; keine
  Tagesgrenze. Ohne Zählung steht **keine** Zahl da, nie die des geladenen Fensters.
- **Modulzähler** (`GET …/modul-zaehler`, `src/einsatz/zaehler.rs`): ETB, Betroffene, Einheiten,
  Abschnitte, Dokumente (LFH-666) als Gesamtmenge; Meldungen, Aufträge, Erinnerungen, Chat als
  Handlungsmenge. Ablösung (Uhr), Betreuung und Wetter/Pegel (LFH-663) zählt der Browser
  (`ClientZaehlerQuelle`). Ohne Recht **fehlt** das Modul (`berechtigung::erlaubte_module`). Wer
  eine gezählte Liste invalidiert, invalidiert `modulZaehler` mit (`ZAEHLER_LISTEN_KEYS`,
  `queryKeys.test.ts`).
- Jede Zeile trägt `data-lfh="datensicht-karte"` und die Zeilenklasse (`scrolleZurZeile`,
  `?eintrag=`). Ein neuer `KARTEN_EIGENBAU` wird gegen den Plan-Modus begründet (Titel, Status,
  ≤ 3 Sekundärfelder, eine Primäraktion, optional Menü `weitere`) und setzt Marke/Klasse selbst.
- ≥ 50 % Meldungstext im Fükw: `e2e/etb-chronologie.spec.ts`, gegen die **Contentbreite**.
- **ETB-Entwürfe schreiben nur über `etb/entwuerfe/entwurfStore.ts`** (LFH-521): ein Neuladen
  bricht offene IndexedDB-Transaktionen ab, deshalb steht jeder Auftrag vor dem ersten `await`
  synchron im Vorlauf (`localStorage`, ein Schlüssel `lifeline-etb-entwuerfe-ausstehend:<id>` je
  Entwurf, nie eine gemeinsame Tabelle — Tabs überschrieben sich; Quittung per `stand`);
  `entwuerfeLaden` trägt nach, jüngere Plattenfassung gewinnt.
  Nachweis `e2e/etb-entwurf-tabs.spec.ts`: ausstehend beim Reload und gespeichert getrennt.
- **ETB-Entwürfe gehören der Person, die sie schreibt** (LFH-767): `benutzer_id` am Entwurf,
  gelesen nur über den Index `by-benutzer-einsatz`, Aktiv-Merker `aktivSchluessel(benutzer,
einsatz)`. Abmelden und die Anmeldung eines anderen löschen sie, ein Sitzungsende (401) nicht
  — ein Entwurf ist das Einzige, was der Server nicht wieder liefert. Ohne angemeldeten Besitzer
  höchstens 24 h ab der letzten Änderung. Regel und Weg hinaus: `offline/AGENTS.md`,
  „Gerätedaten“; Nachweis `auth/geraetRaeumung.integration.test.tsx`,
  `e2e/geraet-raeumung.spec.ts`.
- **Von und An sind Pflicht für jeden neuen Eintrag** (LFH-894, Spec `etb-absender-empfaenger`):
  der Server lehnt einen Eintrag ohne eine Seite mit 400 ab (`routes/etb.rs::erfassen`), der
  Client sendet ihn gar nicht erst (`fehlendeSeite`, vor Upload und Warteschlange). Bestehende
  Einträge bleiben, Entwürfe dürfen unvollständig sein. Systemeinträge (`etb::repo::einfuegen`)
  tragen für eine fehlende Seite die feste Kennung `etb::SYSTEM_RUFNAME` („System“).
- **Standard-Rufname je Person** im Präferenz-Fach (`etb_standard_rufname`, JSON `{von, an}`,
  `etb/standardRufname.ts`, `etb/useStandardRufname.ts`). Er lebt **nie im Entwurf**:
  `metadaten` hält nur Ausdrückliches, `wirksameMetadaten` setzt ihn erst beim Anzeigen und
  Absenden ein. `@`, `/von`, `/an` überschreiben ihn für den einen Eintrag. Ohne Standard fragt
  die Erfassung inline (`etb/RufnameAbfrage.tsx`, kein Modal), erst wenn das Fach gelesen ist;
  in der Berichtigung wird nicht gefragt.
