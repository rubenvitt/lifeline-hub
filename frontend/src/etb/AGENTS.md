# ETB — Regeln

Gilt für `frontend/src/etb/`, `pages/EtbPage.tsx`, `pages/EtbDruckPage.tsx`,
`pages/LagemeldungenPage.tsx`, ergänzt `frontend/AGENTS.md`. Pfade relativ zu `frontend/src/`.

**ETB: ein Tagebuch wird gelesen — auf allen Breiten eine Zeitachse** (`etb/EtbZeitachse.tsx`,
Ableitungen in `etb/zeitachseModell.ts`)

- Keine Sortierung/Spaltenfilter/-auswahl; Ordnung = Zeit (Server). Ebenso Lagemeldungen
  (`pages/LagemeldungenPage.tsx`, Tagesgrenze in der Anzeigezone, `lagemeldungen/zeitachse.ts`);
  ihre Zeit ist die Ereigniszeit der Quellmeldung (`ereigniszeit`), nicht die Übergabe, die nur
  im Meta steht (LLH-1039).
- **Lagemeldungen sind Meldungen** (LLH-1031, Spec `meldungseingang`): die Seite liest die
  lagerelevanten Meldungen, kein eigenes Lageobjekt; Kennung einer Zeile ist die Meldung
  (`lagemeldung:<meldung-id>`). „Lagemeldung erfassen“ (Seitenkopf und Leerzustand) öffnet ein
  `Paneel` mit `meldungen/MeldungFormular.tsx` (`artVorgabe="lagemeldung"`, ohne Serie, schließt
  nach dem Erfassen; kein zweites Formular). Ohne Schreibrecht im Einsatz oder ohne Modul
  Meldungen fehlt es, der Kopf zeigt „Nur Ansicht · Grund“ (`MODUL_MELDUNGEN_GESPERRT`); die
  Kenntnisnahme hängt am Einsatz-Schreibrecht. Die Zeile trägt Typkante „Lage“ (Typwort bei
  übernommener Meldung anderer Art deren Wort), genau eine Marke „Neu“ (Kenntnisnahme, LLH-1206),
  Priorität nur wenn nicht normal, „Extern“, Gerät am Verfasser („· Gerät“); der
  Bearbeitungsstand der Meldung steht am Sprung („Meldung #12 · In Bearbeitung“) und fehlt,
  solange sie „neu“ ist. „Alle als gesehen markieren“ schickt die Kennungen der angezeigten
  neuen (nach Filter). Das automatische ETB einer Lagemeldung trägt Typ „Lage“.
- **Funkprotokoll-Ordnung** (LLH-1149, Entscheidung Ruben 10.10./17.10.2026, Specs
  `etb-zeitachse-darstellung`, `etb-zeitachse-fenster`, Herleitung
  `openspec/changes/archive/2026-10-17-gonnp1g8-etb-ux-durchgang/design.md` D1–D3): älteste Zeile oben, neueste
  unten direkt über der Erfassung, Stundengruppen aufsteigend, gepufferte ganz unten (abgelehnte
  zuletzt), ihre Hinweise unter der Zeitachse. Gekehrt wird nur in der Darstellung
  (`funkprotokollFolge`, nach dem Zufluss); Server, Cursor, Bilanz, Druck und Sprung behalten die
  Serverordnung. Den Bildlauf am Dokument trägt `components/useFunkprotokollLauf.ts`: Öffnen am
  Ende (außer mit `?eintrag=`), Mitlaufen am Ende an der jüngsten Zeile, Anker beim Nachladen
  oben (`overflow-anchor: none`, eigene Korrektur). „Ende“ ist die Unterkante der
  Zeitachsenspalte über der Erfassung (`ende`), nicht das Dokumentende: unter `xl` steht die
  Bilanz darunter, um die Höhe der Erfassung abgesetzt. Eingefroren wird bei Fokus in der Achse ODER
  nicht am Ende; das Sammelbanner steht unten über der Erfassung. Nach dem eigenen Eintrag rollt
  die Seite ans Ende. Die Lesemarke ist eine Trennlinie unter dem zuletzt gesichteten Eintrag,
  wenn er im ungefilterten Fenster steht (`lesemarkeImFenster`), sonst ein Banner mit „Zur Marke
  springen“. „Nach oben“ (`etb/nachOben.ts`) steht erst ab mehr als einer Fensterhöhe Abstand
  zum Anfang, rechts in der Überlagerung der Zeitachse über dem Sammelbanner (gestapelt, nie
  darüber gelegt). Lagemeldungen bleiben neueste zuerst.
  `KARTEN_EIGENBAU` ist leer (`datensicht.guard.test.ts` pinnt 0).
- Seitenleiste „Bilanz" (`etb/EtbBilanz.tsx`); unter `xl` erst nach der ersten Liste, dann
  stehend (Riegel `bilanzFrei`, nicht `isLoading`).
- **Erfassung** hängt auf jeder Breite als `fuss` an der Wurzel von `EinsatzSeite`
  (`.etb-erfassung-sticky`; ≤ 50 % Fensterhöhe, oben voll sichtbar — `e2e/leisten-flaeche.spec.ts`,
  `fokus-verdeckung.spec.ts`). Fokusabstand per `scroll-margin-block-end`
  (`--lfh-etb-fokusabstand`, `components/fokusabstandUnten.ts`), **nicht** `scroll-padding`.
  Unter `md`: Feld eigene Zeile (`Schnellerfassungszeile gestapelt`, im DOM zuerst), Feldzeile
  rollt waagerecht, „Werte behalten" in der Hinweiszeile, Platzhalter „Inhalt …“, Fokus per
  `preventScroll` (`MetaChip`, nicht `autoFocus`).
- **Erfassung, Tastatur und Fläche** (LFH-955, Specs `etb-schnellerfassung-tastatur`,
  `einsatztauglichkeit-layout`; Herleitung D1–D5, auf die Code-Kommentare verweisen:
  `openspec/changes/archive/2026-10-05-lfh-955-etb-erfassung-beruehrung-handschirm/design.md`):
  - **Enter weicht nach der Zeigerart, nicht nach der Breite** (`useViewport().istBeruehrung`):
    mit grobem Zeiger bricht Return um und sendet nie, gesendet wird über „Erfassen“ oder
    Strg/⌘+Enter; das Feld trägt `enterKeyHint="enter"`. Mit feinem Zeiger gilt LFH-335 (Enter
    sendet einen Einzeiler). Den Vertrag zeigt die Tastenkappe ↵ an „Erfassen“ (nur feiner
    Zeiger und ab `lg`, sonst fiele das Feld unter 60 %, LFH-1078); Hinweiszeile und Platzhalter nennen keine Taste und nie „Befehle“.
  - **Feldbreite per Opt-in:** `Schnellerfassungszeile feldFuellt` streckt das Kind der Feldzelle
    (`.lfh-schnellerfassung__feld--fuellt`); das ETB setzt es immer, ab `md` ≥ 60 % der Zeile.
    Keine pauschale Regel: eine Zelle mit mehreren Feldern (Infotelefon) bleibt ungestreckt.
  - **Unter `md` zuerst die Zeitachse:** Druck im Menü „Weitere“ (`MenueAusloeser`; der
    Einsatzabschluss steht auf den Einsatzdaten, LFH-960), Typfilter einzeilig rollend im Kopf,
    Zeitraum, Einheit, Systemeinträge und Volltext hinter „Filter (n)“ (ein Filter von außen
    klappt sie auf). Die Leiste startet
    eingeklappt (`EtbEntwurfsTabs einklappbar`, `Schnellerfassung eingeklappt`): kein Fokus beim
    Mount, ohne Reiterband, Feld- und Hinweiszeile, solange der Fokus nicht in ihr liegt und genau
    ein leerer Entwurf ohne Dateien steht. Popups der Leiste zählen als „in der Leiste“
    (`LEISTEN_SCHWEBE`, `components/fokusInLeiste.ts`, auch für das Informationstelefon). Nachweis: zwei Einträge ganz im Bild auf
    390 × 844, auch ohne Abschließen-Recht (`e2e/leisten-flaeche.spec.ts`).
  - **Typ und Ereigniszeit am Textanfang** (LLH-1112/LLH-1088): der Präfix zeigt das Typwort in
    der Typfarbe, die Zeile ihren Rahmen samt Fokusring in der Typfarbe, vorn als 2-px-Kante
    (`Schnellerfassungszeile rahmenFarbe`); `/typ ` und danach
    `/zeit <Angabe> ` setzen Typ und Ereigniszeit (`erkenneTypBefehl`, `erkenneZeitBefehl`,
    gedeutet nur über `deuteZeit` mit `art: 'ereignis'` und `serverJetzt()`), der Rest bleibt
    Inhalt; unlesbar bleibt der Text und die Hinweiszeile nennt den Grund. Eine Ereigniszeit über
    60 s nach der Serveruhr sendet nicht (`zukunftsVerstoss`, vor Upload und Warteschlange, Grund
    am Chip); der Server begrenzt sie nicht. Ein Nachtrag über Mitternacht nennt die Erfassung mit
    Tag (`nachtragText`).
- **Kopfzahl und Bilanz zählt der Server über DENSELBEN Filter** (LFH-612, `GET …/etb/zaehler`,
  `etb/repo.rs:filter_bedingung`, Parameter nur über `routes/etb.rs:filter_merkmale`; Parität
  `tests/etb_zaehler.rs`). „412 Einträge"/„Bilanz" bzw. „7 Treffer"/„Bilanz im Filter"; keine
  Tagesgrenze. Ohne Zählung steht **keine** Zahl da, nie die des geladenen Fensters.
- **Eine Filterleiste** (LLH-1065/LLH-1080, Spec `etb-filterleiste`, Herleitung
  `openspec/changes/archive/2026-10-17-gonnp1g8-etb-ux-durchgang/design.md` D4–D5): ab `md` stehen alle Filter in
  `EtbFilterleiste` über der Zeitachse, in zwei Gruppen — Typ-Segmente und Umschaltknopf „System“
  (`SegmentUmschalter`, `aria-pressed`, fester Name „Systemeinträge zeigen“, Zahl als
  Beschreibung), dann Zeitraum (`EtbZeitraumWahl`), Einheit, Volltext. Der Seitenkopf trägt ab
  `md` keinen Filter. Die Leiste führt nur `q` (entprellt); Typ, System, Zeitraum und Einheit
  sind Sprungwerte der Seite aus der URL. Der Zeitraum schreibt bei jeder Wahl ABSOLUTE,
  minutengenaue Grenzen (`anzeige/zeitfenster.ts`); „Seit letzter Lagebesprechung“ nur mit
  Freigabe `lagebesprechung` und abgehaltener Besprechung.
- **Systemeinträge ausblenden** (LFH-958, Spec `etb-zeitachse-darstellung`): `ohne_system=true`
  ist ein Filtermerkmal wie die übrigen, nur über `filter_merkmale`/`filter_bedingung`; Liste,
  `zaehler` und `anzahl` erben ihn zusammen. Zustand in der URL (`etbPfad`/`parseEtbFilter`),
  nur `true` oder fehlend; neben `typ=system` fällt er weg (sonst 422, `filterZusammenfuehren`).
  Ein `?eintrag=`, der unter dem Ausschluss nicht auftaucht, blendet wieder ein und sagt es.
- **Systemeinträge leise und gebündelt** (LLH-1106, Spec `etb-zeitachse-darstellung`): ein
  Systemeintrag steht als `Zeitachseneintrag leise` (Text `gedaempft`, `textKlein`, ungekürzt,
  ohne Tönung); „System → System“ entfällt (`etb/systemKennung.ts` spiegelt
  `etb::SYSTEM_RUFNAME`). Ab drei direkt aufeinanderfolgenden schlichten Systemeinträgen einer
  Stundengruppe steht eine Bündelzeile (`buendleSystemfolgen`, nach `gruppiereNachStunde`);
  berichtigt, nachgetragen, Anhang, Dokument oder Rückverweis brechen die Folge, ebenso die
  Lesemarke. Schlüssel ist der älteste Eintrag (offen bleibt offen); ein Sprung klappt im Render
  auf. Kein Bündel unter `typ=system`, unter `q` und nie im Druck.
- **Modulzähler** (`GET …/modul-zaehler`, `src/einsatz/zaehler.rs`): ETB, Betroffene, Einheiten,
  Abschnitte, Dokumente (LFH-666) als Gesamtmenge; Meldungen, Aufträge, Erinnerungen, Chat,
  Lagemeldungen und Nachforderungen (davon überfällig, LLH-1145) als Handlungsmenge. Der Server zählt sie per Aggregat ohne Listen zu laden, über dieselben
  SQL-Fragmente wie die Listen (LFH-935, `tests/modul_zaehler_abfragen.rs`). Ablösung (Uhr), Betreuung und Wetter/Pegel (LFH-663) zählt der Browser
  (`ClientZaehlerQuelle`). Ohne Recht **fehlt** das Modul (`berechtigung::erlaubte_module`). Wer
  eine gezählte Liste invalidiert, invalidiert `modulZaehler` mit (`ZAEHLER_LISTEN_KEYS`,
  `queryKeys.test.ts`).
- **Seitenfenster** (LFH-947, Spec `etb-zeitachse-fenster`, Herleitung
  `openspec/changes/archive/2026-10-06-lfh-947-etb-zeitachse-seitenfenster/design.md`): die Liste
  hält höchstens `ETB_MAX_SEITEN` (5) Seiten (`etb/seitenfenster.ts`); Seitenparameter mit
  Richtung (`{ aelter }` → `before_lfd_nr`, `{ neuer }` → `after_lfd_nr`), nie eine nackte Zahl.
  „Ältere laden“ steht über der Zeitachse; fällt der Kopf heraus, steht „Neuere laden“ darunter. Ein `?eintrag=` wählt die
  Richtung aus der Kennung (`sprungRichtung`); kein `resetQueries`, das räumte das Lagebild ohne
  Netz. Nach einem eigenen Eintrag aus tiefem Fenster ersetzt die Seite das Fenster durch die
  neueste Seite (`zumKopf`) und rollt ans Ende. Wer die Liste ohne Versand invalidiert, lädt das ganze Fenster neu und bricht ein
  laufendes Nachladen ab (`offline/useEtbErfassung.ts`).
- **Gemerktes Rendern** (LFH-947): `eintraege`, `chronologie`, Zufluss und Gruppen sind
  `useMemo`, die Zeile (`EtbZeitachsenZeile`) und `components/Markdown` sind `memo`, Handler
  laufen über eine Ref, die Gruppe wird über Stunde und Vorkommen geschlüsselt (nie über die
  erste Zeile). Ein neuer Eintrag parst nur seinen Text (`etb/EtbZeitachse.render.test.tsx`).
  Jede Stundengruppe trägt `.etb-stundengruppe` (`content-visibility: auto`, `index.css`).
- Jede Zeile trägt `data-lfh="datensicht-karte"` und die Zeilenklasse (`scrolleZurZeile`,
  `?eintrag=`). Ein neuer `KARTEN_EIGENBAU` wird gegen den Plan-Modus begründet (Titel, Status,
  ≤ 3 Sekundärfelder, eine Primäraktion, optional Menü `weitere`) und setzt Marke/Klasse selbst.
- ≥ 50 % Meldungstext im Fükw: `e2e/etb-chronologie.spec.ts`, gegen die **Contentbreite**.
- **Kompakte Zeile** (LFH-958, `zeitachsenAufbau` in `components/instrument/Zeitachseneintrag.tsx`):
  unter 48 px Bedienhöhe stehen Verfasser (einzeilig, Titel mit Volltext) und Weg in der
  Kopfzeile. Ein Zeilenmenü geht über `menue`, das in `kompakt` am Ende der Kopfzeile steht;
  `aktionen` sind Text-Knöpfe und bleiben rechts. Nachweis ≤ 56 px und ≥ 9 Einträge bei
  1440 × 900: `e2e/etb-zeilenhoehe.spec.ts`.
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
- **Leere Entwürfe räumt `entwuerfeLaden`** (LFH-941, D8): eigene Entwürfe ohne Inhalt, die
  länger als 24 h unverändert sind, über alle Einsätze, mit Vorlauf-Disziplin; danach jeder
  eigene Aktiv-Merker eines Einsatzes ohne Entwurf. Entwürfe mit Inhalt bleiben unabhängig vom
  Alter (Entscheidung Ruben, 06.10.2026: keine Frist für ungesendeten Text). Herleitung:
  `openspec/changes/archive/2026-10-06-lfh-939-941-offline-speicher-begrenzen/design.md`.
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
- **Meldung und Lage gehen in den Meldungseingang** (LLH-1037, Specs `meldungseingang`,
  `etb-schnellerfassung-tastatur`): bei diesen Typen (nicht in der Berichtigung) zeigt
  `Schnellerfassung.tsx` den Schalter „Nur protokollieren“, Vorgabe aus; aus legt der Server
  Eintrag und Meldung an (Typ „Lage“ → Art „Lagemeldung“, Typ „Meldung“ → Art „Sonstige“). Ab `md`
  steht er mit „Werte behalten“ rechts im Reiterband der Entwürfe (`EtbEntwurfsTabs` reicht den
  Platz als `einstellungenZiel`, die Schnellerfassung hängt die Gruppe per Portal hinein; ohne
  Platz rechts in der Chip-Zeile), darunter in der Hinweiszeile. In der Chip-Zeile brach die
  Gruppe im Handschuh-Betrieb auf dem Fükw um und hob die Leiste um eine Kästchenhöhe
  (`fokus-verdeckung.spec.ts`, „Nach oben“ hinter dem Kopf). Er bricht weder die Feldbreite
  (≥ 60 % ab `md`) noch die eingeklappte Handy-Leiste. Er springt nach jedem
  Erfassen auf aus zurück, auch mit „Werte behalten“, und lebt im Entwurf (`nur_protokollieren`,
  optional, kein Versionssprung). Ist das Modul Meldungen gesperrt (`useSprungSperre`), steht er
  an und gesperrt mit dem Grund `MODUL_MELDUNGEN_GESPERRT`. Der Client sendet
  `in_meldungseingang` immer ausdrücklich, auch über die Warteschlange
  (`offline/useEtbErfassung.ts` reicht es durch). Eine beim Abspielen abgelehnte Zeile mit
  Kopplung bietet „Nur protokollieren“ an (`EtbZeitachse` → `EtbPage.abgelehntErneutSenden`, mit
  neuer `client_id`, sonst 409). Eine aus dem ETB angelegte Meldung bekommt keinen zweiten
  Eintrag; der Verweis „Meldung #n“ kommt aus `meldung_id`/`meldung_lfd_nr` (LLH-1104).

**Meldungsmodell (LLH-1027, Entscheidung 21.10.2026) — Zielbild, gilt ab dem jeweiligen
Folgeticket; bis dahin gilt das Bestehende**

Das Ticket, das einen Punkt baut, schreibt die Regeln oben und die Specs fort und streicht den
Punkt hier. Begriffe, Datenfluss und Zustände: `docs/design/2026-10-21-meldungsmodell/README.md`;
Entscheidung und Herleitung: `/mnt/project-files/llh-1021/llh-1027/design.md`.

- **Wortlaut:** Die Mehrzahl von „Lage“ bleibt „Lagefeststellungen“; „Lagemeldungen“ ist nur das Modul.
