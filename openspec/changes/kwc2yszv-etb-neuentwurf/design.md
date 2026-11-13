# Design

## Context

Motivation und Umfang: `proposal.md`. Grundlage ist der freigegebene Entwurf
`docs/design/2026-11-12-etb/` (Zeichenflächen und README mit den Entscheidungen Rubens vom
12.11.2026). Die Anforderungen stehen in den Delta-Specs dieser Change.

Heute:

- **Erfassung** (`etb/Schnellerfassung.tsx`, 1.400 Zeilen): Inhalt in einer
  `Schnellerfassungszeile`, Typ als Präfix-Knopf, alle übrigen Angaben als `MetaChip` mit genau
  einem offenen Editor (`editFeld`). Von/An kommen über `wirksameMetadaten` aus dem
  Standard-Rufnamen, ohne Bezug zum Typ. LLH-1842 hat die Liste der Chips (`chipFelder`) und das
  Übernehmen beim Verlassen nachgerüstet.
- **Zeitachse** (`etb/EtbZeitachse.tsx`) baut jede Zeile über den gemeinsamen Baustein
  `components/instrument/Zeitachseneintrag.tsx`, den elf weitere Flächen nutzen (Lagemeldungen,
  Infotelefon, Kräfte-Zeitachse, Lagebild, Archiv …).
- **Bilanz** (`etb/EtbBilanz.tsx`): Zahlen je Typ, Berichtigungen, Puffer (Sendestatus).
- **Filterleiste** (`etb/EtbFilterleiste.tsx`) steht über der Zeitachse und rollt mit; das ETB
  öffnet am Ende (`components/useFunkprotokollLauf.ts`).
- **Systemeinträge**: Filtermerkmal `ohne_system` in der Adresse, Vorgabe eingeblendet.

## Goals / Non-Goals

**Goals:**
- Die Feldzeile ersetzt Chips und Editoren vollständig; danach gibt es in der ETB-Erfassung keinen
  „offenen Editor“ mehr, und LLH-1865 entfällt ohne Sonderregel.
- Eine Spaltenzeile nur für das ETB; die übrigen Nutzer von `Zeitachseneintrag` bleiben unberührt.
- Kein Backend, kein Wire-Feld, keine Migration.

**Non-Goals:**
- Druck des ETB (LLH-1837), Banner für eigene Einträge anderer Geräte (LLH-1833), fester Rahmen der
  App (LLH-1727), Empfänger im Dialog „Auftrag erteilen“, unlesbare Zeit beim Senden (LLH-1866).
- Lagemeldungen und Informationstelefon behalten ihre Zeitachse.

## Decisions

### D1 Spaltenzeile im ETB statt Umbau von `Zeitachseneintrag`
Die kompakte ETB-Zeile entsteht als eigene Komponente im ETB (`etb/EtbSpaltenzeile.tsx`) mit einem
CSS-Grid, dessen Spaltenbreiten der Spaltenkopf teilt (eine Konstante, kein Messen). Komfortabel
und Handschuh behalten `Zeitachseneintrag`; unter `md` gilt die Handschirm-Zeile (Kopfzeile plus
Text).
*Verworfen:* `Zeitachseneintrag` um einen Spaltenmodus erweitern — elf Nutzer, deren Dichte- und
Kontrast-Gates mitliefen, für eine Form, die nur das ETB braucht.

### D2 Feldzeile aus vorhandenen Bausteinen
Typ: `Segmentleiste` (unter `md` Knopf mit Pfeil und Menü). Zeit: `ZeitpunktEingabe` mit `art="ereignis"`,
leer = „jetzt“ (Platzhalter zeigt die Uhrzeit), Schnellwahl im Kalender. Von/An:
`StammdatenFeld` im Modus `nurText` mit den bisherigen Quellen. Meldeweg: Auswahl aus den bisherigen
Werten. Die Felder schreiben direkt in `metadaten`; die Veranlassung ist ein weiteres Textfeld, das
„+ Veranlassung“ in die Zeile holt. `MetaChip` entfällt ganz (beim Bau entschieden: ein Chip nur
für die Veranlassung hätte `editFeld` für ein Feld behalten), ebenso `editFeld`, `chipFelder` und
`editNeu` aus LLH-1842. Die Buchstabierhilfe (LFH-110) steht neben Von und An, ohne Tab-Stopp.
*Verworfen:* Chips behalten und nur sichtbarer machen — der Fehlerort von LLH-1842 und LLH-1865
bliebe.

### D3 Vorgabe nach Typ in `wirksameMetadaten`
`standardRufname.ts` bekommt den Typ als Eingang und liefert die Vorgabe der Tabelle aus der Spec
`etb-absender-empfaenger`. Der Entwurf speichert weiter nur Ausdrückliches (Regel „Standard lebt
nie im Entwurf“); ein Typwechsel ändert deshalb nur die Vorgabe. Die Inline-Abfrage des Rufnamens
bleibt und fragt die eigene Stelle.

### D4 „Auch in den Meldungseingang“ als Vorgabe mit Übersteuerung
Das Entwurfsfeld `nur_protokollieren` bleibt (gespeicherte Schlüssel ändern sich nicht), wird aber
dreiwertig gelesen: fehlt es, gilt die Vorgabe (an, außer Von = An = eigene Stelle); `true` oder
`false` ist eine Handwahl. Auf dem Wire bleibt `in_meldungseingang`, der Server ist unverändert.
Folge: Eine Lagefeststellung mit Vorgabe-Von/An geht nicht mehr in den Meldungseingang — gewollt
(LLH-1757), eine Lage von außen setzt Von und geht hinein.

### D5 Eine Tastaturregel für `StammdatenFeld`
Der oberste passende Vorschlag ist markiert; Enter und Tab nehmen ihn. Freitext trotz Treffer über
den letzten Eintrag „„…“ als Freitext übernehmen“. Das gilt für alle Nutzer des Bausteins
(ETB-Felder, Rufname-Abfrage, `meldungen/MeldungFormular.tsx`).
*Verworfen:* Regel nur im ETB — zwei Verhalten desselben Feldes, und das Meldungsformular hätte
dieselbe Falle („San“ als Absender).

### D6 Systemeinträge: Vorgabe aus, Adresse `system=an`
Die Seite schickt dem Server ohne Wahl `ohne_system=true`; eingeblendet steht `system=an` in der
Adresse. Ein alter Link mit `ohne_system=true` gilt wie die Vorgabe. Ein alter Link ohne Merkmal,
der früher Systemeinträge zeigte, zeigt sie jetzt nicht; ein Sprung auf einen Systemeintrag blendet
weiter selbst ein.

### D7 Bilanz entfällt, Zahlen an die Segmente, Sendestatus in den Kopf
Die Typ-Segmente der Filterleiste lesen `je_typ` der Zählung. Der Puffer-Zustand der Bilanz
(übertragen, ausstehend, abgelehnt) wandert als eine Marke in den Seitenkopf, mit Sprung zu den
vorgemerkten Zeilen. Die Liste „Berichtigungen“ entfällt; der Typfilter „Berichtigung“ ersetzt sie.

### D8 Kleben über `--lfh-rahmen-oben`
Filterleiste und Spaltenkopf kleben mit `top: var(--lfh-rahmen-oben)` plus der Höhe des
Seitenkopfs (Regel „Wer oben klebt, hängt sich unter den Rahmen“). Der Fokusabstand
(`scroll-padding-block-start`) wächst um ihre Höhe, damit ein Sprung nicht unter ihnen landet.
Beim Bau ergänzt: Seitenkopf, Filterleiste und Spaltenkopf kleben nur, solange sie zusammen
höchstens ein Drittel der Fensterhöhe belegen (`etb/etbKopfKleben.ts`, `KLEBEN_HOECHSTENS`); bei
1366 × 520 im Handschuh-Betrieb bliebe zwischen ihnen und der Erfassung sonst kein Platz für den
Fokus (WCAG 2.4.11, `e2e/fokus-verdeckung.spec.ts`). Ein Druck mit der Vorgabe nennt im Druckkopf
„ohne Systemeinträge“; den Druck ordnet LLH-1837 neu.

### D9 Niedriges Fenster: eine rollende Zeile
Beim Bau gemessen: im Handschuh-Betrieb sind Feldzeile (zwei Reihen), Inhalt und Fußzeile am
Fükw 356 px hoch (Grenze 384 px), bei 1366 × 520 aber fast 70 % der Fensterhöhe; Zeilen der
Zeitachse verschwanden beim Tabben hinter der Leiste. Unter 700 px Fensterhöhe stehen ab `md`
deshalb Typ-Knopf, Felder und Fußzeile in einer waagerecht rollenden Zeile
(`etb/useNiedrigesFenster.ts`). Der Fükw (768 px) behält die gezeichnete Form.
*Verworfen:* die Leiste ab `md` einklappen wie auf dem Handschirm — beim Schreiben läge sie
weiter über der halben Höhe.

## Risks / Trade-offs

- [Die Leiste wird eine Zeile höher] → Feldzeile, Inhalt, Fußzeile ≈ 130 px am Fükw; die Grenze
  „höchstens halbe Fensterhöhe“ bleibt, am Handschirm ist die Leiste eingeklappt eine Zeile.
- [Meldungstext unter 50 % der Contentbreite] → mit offenem Modulpanel rund 49 % (README
  „Abweichungen“); die Regel in `frontend/src/etb/AGENTS.md` und `e2e/etb-chronologie.spec.ts` wird
  auf „Spalte Inhalt ≥ 45 % und breiteste Spalte“ fortgeschrieben.
- [Alte Links ohne Merkmal blenden Systemeinträge aus] → Sprung blendet ein; Hinweis in der
  Anwenderdoku.
- [Tastaturregel ändert das Meldungsformular] → gleiche Falle dort; e2e und Unit-Tests des
  Formulars ziehen mit.
- [Viele e2e-Specs messen die alte Zeile] → je Gruppe in den Aufgaben, nicht am Ende.

## Migration Plan

Reiner Frontend-Umbau, kein Datenumzug. Gespeicherte Entwürfe tragen weiter `metadaten` und
`nur_protokollieren`; ein Entwurf mit `nur_protokollieren: true` bleibt eine Handwahl „aus“.
Rückweg: Revert des Merge-Commits.

## Open Questions

- Spaltenbreiten am Fükw (Zeit 48, Nr. 34, Typ 78, Von → An 210, Vermerk 124 px aus dem Entwurf)
  werden beim Bau gegen echte Daten nachgemessen; das ändert weder Specs noch Aufgaben.
