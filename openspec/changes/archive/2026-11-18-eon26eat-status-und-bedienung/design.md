# Design

## Context

Motivation in `proposal.md`. Abgestimmt am Phase-1-Checkpoint vom 16.11.2026 (LLH-1720, Felder
`plan` der Unteraufgaben): ein Baustein `Status`, randlos getönt mit Formzeichen, zwei Größen;
Kennzeichnungen als neutrale `Marke`; Guard gegen rohe Tags; bedienbarer Status getönt mit Rahmen,
Pfeil und größerer Schrift; Rufname als Menükopf, Menü im Fenster, Quittung mit echtem
Rücknahmeweg nur für Fahrzeug-FMS; Tableau mit großem Statusblock. Welle 1 hat die Rollen
festgelegt (Spec `statusrollen`): „gebunden“ ist neutral, Sprechwunsch gelb.

Ist-Stand (Scope-Scan 18.11.2026):

- **Zwei Anzeigebausteine.** `components/StatusTag.tsx` (antd-`Tag`, Fläche aus `statusFlaeche`
  mit 1-px-Rand in der Rollenkante, Formzeichen aus `darstellung.form`, Mandantenfarbe als Punkt,
  keine Größen; 90 Stellen in 61 Dateien) und `StatusChip` in `components/instrument/Status.tsx`
  (Span, 22 px, randlos, ohne Formzeichen; 79 Stellen in 50 Dateien). Der Rand des `StatusTag`
  ist heute die Kante, die `e2e/kraefte-kontrast.spec.ts` mit ≥ 3 : 1 misst.
- **Rohes `Tag`** in rund 43 Dateien (Zustände wie „storniert“, Kennzeichnungen wie „ad-hoc“,
  Typen, zwei entfernbare Filter-Marken). `theme/statusVertrag.guard.test.ts` verbietet schon
  `color` am `Tag`; `eslint.config.js` sperrt antd-`Select` per `no-restricted-imports`.
- **Bedienbarer Status.** `components/StatusWahl.tsx` ist die einzige Stelle: `Dropdown` um einen
  `Button type="text"`, darin der `StatusTag`. Der Knopf erbt die Dichtehöhe 30/48/72, das
  Etikett bleibt 22 px. Elf Abnehmer, darunter `FmsTableau`, `FahrzeugePage`,
  `FahrzeugeBesatzung`, Personal, Material, Einheitskopf, Infotelefon. Kein Kopf, keine
  Platzierungsvorgabe.
- **Statuswechsel im Server.** `PATCH /api/einsaetze/{id}/fahrzeuge/{ef_id}` mit `status_id`
  (`routes/einsatz_fahrzeug.rs:297`), eine Transaktion: `disposition_repo::update_tx` setzt
  `status_seit = datetime('now')`, `zeitachse::repo::aus_fahrzeugstatus_tx` schreibt ein
  Einheitsereignis (nur mit `zeitachse_marke` und Einheit) und Kopien bei der Besatzung, das ETB
  bekommt „Fahrzeug «X»: Status «A» → «B»“. Der Status davor und wer gewechselt hat, werden nicht
  gespeichert. Kein Offline-Weg.
- **Vorbild Rücknahme.** „Entlassung zurücknehmen“ (LLH-1722): eigene POST-Route, der Client
  schickt den Vorzustand, der Server prüft Person, Zeitpunkt und zehn Minuten, sonst 409
  `veraltet`. Streichen in der Zeitachse über `streiche_tx` (nimmt Kopien und die
  Ablösungskopplung mit). Hinweis über `kommunikation/rueckgaengig.tsx` (`zeigeRueckgaengig`).
- **Tableau.** `kraefte/FmsTableau.tsx`: Raster `minmax(min(100%, 208px), 1fr)` je Abschnitt,
  Rufname 13 px, Status als `StatusChip` 11 px, Fahrzeugtyp fehlt, obwohl `fahrzeugtyp` im DTO
  steht. Zifferntasten über `zifferZuordnung`, Fokusrückgabe über
  `[data-lfh=fms-kachel] button`.

## Goals / Non-Goals

**Goals:**

- Ein Zustand sieht überall gleich aus; ob man ihn bedienen kann, sieht man am Rahmen.
- Ein Fehlgriff beim FMS-Status ist sichtbar und in einem Schritt zurückzunehmen.

**Non-Goals:**

- Rücknahme für Personal-, Material- und Einheitsstatus: Folgeaufgabe (Abstimmung 16.11.).
- Die Sichtung (`SichtungsTag`): Sie bleibt das umrandete BBK-Feld (D6).
- Kartenkanten der Kommunikation und Statuszellen in Rastern (`StatusZelle`): bleiben, wie
  Welle 1 sie gesetzt hat.
- Rollen und Farben: unverändert aus Welle 1.

## Decisions

### D1 — `Status` ersetzt `StatusTag` und `StatusChip`

Ein Baustein `Status` in `components/instrument/Status.tsx`, neben `StatusZelle`. Props:
`ton` (oder `darstellung` aus dem Statusvertrag), `wort` (Pflicht), `code?`, `form?`,
`farbe?` (Mandantenfarbe als Punkt), `groesse: 'klein' | 'normal'` (Vorgabe `normal`),
`umbrechen?`, `title?`. Randlos, Fläche und Text aus `statusFlaeche`. Größen: `klein` 20 px hoch,
11 px Schrift (Tabellenzeilen, Raster, Kachelköpfe); `normal` 24 px, 12 px (Kopf, Detail).
Formzeichen nach Rolle, wenn `form` fehlt: `alarm` ▲, `achtung` ▮, `normal` ●; `neutral` und
`bedien` ohne Zeichen. Das Zeichen ist `aria-hidden`.

`StatusTag.tsx` und `StatusChip` entfallen; alle Stellen werden umgestellt (Codemod für die
mechanischen Fälle, der Rest von Hand). Die Mandantenfarbe erzwingt keine Randform mehr, sie
bleibt Punkt neben der Rollenfläche.

*Verworfen:* `StatusTag` umbauen und `StatusChip` als Alias behalten. Zwei Namen für eine Form
laufen wieder auseinander, und die Bausteinwahl müsste beide erklären.

*Verworfen:* ein neuer Name wie `Zustand`. `Status` ist das Wort der Oberfläche, und die Datei
`instrument/Status.tsx` trägt es schon.

### D2 — `Marke` für Kennzeichnungen

`components/instrument/Marke.tsx`: neutrale Fläche `flaeche2`, Text `colorText`, 20 px, 11 px,
randlos, ohne Formzeichen. Mit `onEntfernen` wird sie bedienbar: Rahmen `linieStark`, ein Knopf ✕
mit `aria-label` „<Wort> entfernen“ und der Dichtehöhe. Die bestehenden Marken (`DemoMarke`,
`PrioritaetMarke`, `NichtUebernommenMarke`, `UebungsMarke`, Herkunft) bauen auf ihr auf. Die
Statusrolle `marke` im Vertrag bleibt (Farbe der Marke), der Ordner `src/marke/` (App-Marke) ist
etwas anderes und bleibt unberührt.

### D3 — Urteile bleiben Zustände

„unterbesetzt“, „Besatzung nicht erfasst“, „Soll erfüllt“ sind Urteile mit Statusrolle
(`besatzungsUrteil`, `einheitStaerkeUrteil`; Alarmbudget LFH-962, LLH-1029). Sie werden `Status`,
nicht `Marke`. Was die Analyse bemängelt hat, ist die Verwechslung mit dem bedienbaren Status, und
die löst D4 über den Rahmen. Eine Umfärbung ist nicht Teil dieser Change.

### D4 — Der Statusknopf

`StatusWahl` rendert mit Schreibrecht einen `StatusKnopf`: antd-`Button` (Dichtehöhe aus dem
`ConfigProvider`, also LFH-365 erfüllt), Fläche `statusFlaeche(ton).grund`, Rahmen 1 px
`statusFlaeche(ton).kante`, Formzeichen, Wort 14 px, Pfeil ▾ am Ende. Die Fläche füllt die ganze
Knopfhöhe, damit sichtbar = antippbar. Ohne Schreibrecht rendert `StatusWahl` den `Status` in
Größe `normal` (unverändert: kein gesperrter Knopf). Ein eigenes Etikett (`etikett`, bisher im
Tableau) entfällt zugunsten einer Variante `gross` (D9).

Der Rahmen ist die Kante, die bisher am Etikett gemessen wurde. `e2e/kraefte-kontrast.spec.ts`
misst künftig den Knopfrand gegen Zeile und Knopffläche (≥ 3 : 1, Spec `status-darstellung`).
`statusFlaeche.kante` hält das nach der Tabelle in ihrem Kopf schon; der Nachweis kommt in
`theme/bedienKontrast.test.ts`.

*Verworfen:* neutraler Rahmen `linieStark` für alle Rollen. Er trennt den Knopf gut, aber die
Rolle stünde dann nur in der Fläche, und die Fläche allein misst nachts teils unter 3 : 1 gegen
die Zeile.

### D5 — Sperre gegen rohes `Tag`

`eslint.config.js`: `no-restricted-imports` für `Tag` aus `antd`, Meldung „Zustand → Status,
Kennzeichnung → Marke (frontend/AGENTS.md, Bausteinwahl)“. Ausnahmen per Zeilenkommentar nur in
`instrument/Marke.tsx` und `personen/SichtungsTag.tsx`. Die Prüfung `<Tag color=…>` in
`statusVertrag.guard.test.ts` wird damit überflüssig und entfällt; der Vertragswächter für
`Record<…,StatusDarstellung>` bleibt.

### D6 — Sichtung bleibt das BBK-Feld

`SichtungsTag` behält Fläche und Rand (gelb und schwarz müssen auf beiden Gründen stehen,
Ausnahme in `frontend/AGENTS.md`, Farbachsen). Die bedienbare Sichtung in
`personen/ZeilenSichtung.tsx` bekommt die Knopfform von D4 um das Feld: äußerer Rahmen
`linieStark`, Pfeil ▾, Dichtehöhe. So gilt „Rahmen heißt bedienbar“ am äußeren Rand, das BBK-Feld
innen bleibt Anzeige.

### D7 — Menü: Kopf und Lage

`StatusWahl` bekommt `titel?: string`. Mit Titel stehen die Einträge in einer antd-Menügruppe
(`type: 'group'`, Label = Titel), der Kopf ist nicht wählbar. Fahrzeugstellen (Fahrzeugliste,
Tableau, Einheit-Besatzung) setzen den Rufnamen; andere Abnehmer bleiben ohne Kopf.

Für alle Abnehmer misst `menueLage` beim Öffnen den Platz über und unter dem Auslöser: das Menü
öffnet nach unten, wenn es dort passt oder unten mehr Platz ist, sonst nach oben, und `maxHeight`
begrenzt es auf den Platz dieser Seite (`overflowY: auto`). Im Handschuh-Betrieb, wenn eine Spalte
nicht auf die größere Seite passt, stehen die Einträge in einem Raster mit zwei Spalten, und wenn
auch zwei nicht passen, mit drei (Klassen `lfh-statusmenue--spalten-N` in `theme/sprache.css`). Der
Kopf ist kein Ziel und bleibt flach (höchstens 40 px). Der Befund y = −52 kommt aus der fehlenden
Höhenbegrenzung; antd kippt nur, wenn das Menü auf einer Seite passt.

Nachtrag bei der Umsetzung: Auf der Fahrzeugliste steht der Knopf der obersten Zeile bei
1366 × 520 erst bei y = 385. Oben bleiben 369 px, zwei Spalten brauchen fünf Zeilen à 73 px und den
Kopf (gemessen 450 px). Deshalb die dritte Spalte; zwei Spalten reichen in jedem höheren Fenster.

### D8 — Rücknahme im Server

**Der Server hält den Vorzustand selbst.** Bei jedem echten Wechsel schreibt `update_tx` vier
Spalten an `einsatz_fahrzeug` (Migration 0356): `status_gesetzt_von` (wer), `status_vorher_id` und
`status_vorher_seit` (was davor galt) und, nach dem Zeitachsen-Schreiben, `status_ereignis_id`
(das Ereignis dieses Wechsels; `einheit_ereignis` gibt dafür seine id zurück). Einträge in
`einsatz/schwaerzung_registry.rs`; der Spiegel braucht nichts (ADD COLUMN).

**Beleg im Wechsel.** Die Antwort des Status-PATCH bekommt `status_ruecknahme` (nur bei einem
echten Wechsel): `status_id` und `status_seit` als Prüfwerte, dazu `vorher_status_id` nur für den
Wortlaut der Quittung. Die Rücknahme glaubt dem Beleg nichts außer den Prüfwerten.

**Route.** `POST /api/einsaetze/{id}/fahrzeuge/{ef_id}/status/zuruecknehmen`, Body = Beleg,
`EinsatzSchreibzugriff<Fahrzeuge>`. In einer Transaktion: aktueller `status_id` und `status_seit`
gleich dem Beleg, sonst `AppError::Veraltet` (409 `veraltet`, CAS nach `src/AGENTS.md`);
`status_gesetzt_von` gleich der Person und höchstens zehn Minuten seit `status_seit`, sonst 409
mit Grund. Dann das gemerkte Ereignis per `streiche_tx` mit dem Grund „Statuswechsel
zurückgenommen“ (scheitert es an der Ordnung, rollt alles zurück, 409; ein inzwischen schon
gestrichenes bleibt, wie es ist), Status und „seit“ aus den gemerkten Spalten, die vier Spalten
geleert, ETB-Eintrag, Live-Meldungen wie der Wechsel. Keine Benachrichtigung, und eine
gesendete „wieder verfügbar“ bleibt.

*Geändert nach dem Review vor dem PR (18.11.2026):* Zuerst kamen Vorzustand und Ereignis vom
Client, wie bei „Entlassung zurücknehmen“. Damit hätte jemand innerhalb der zehn Minuten ein
beliebiges eigenes Ereignis der Einheit streichen oder ein erfundenes „seit“ setzen können.

*Verworfen:* eine Statushistorie als Tabelle. Mehr als die Rücknahme braucht, und sie müsste in
den Spiegel.

### D9 — Tableau-Kachel

Kopfzeile: Rufname `monoStil(22, 500)` (Stufe `datenwertKlein`), rechts „seit“ 11 px. Zweite
Zeile: Fahrzeugtyp und Einheit, 12 px, gedämpft, ausgelassen was fehlt. Darunter der Statusblock:
`StatusKnopf` in der Variante `gross` (Ziffer `monoStil(40, 500)` aus `datenwertGross`, Wort
12 px darunter, Breite der Kachel, Mindesthöhe 88 px, in jeder Dichte mindestens die
Dichtehöhe). Ohne Schreibrecht derselbe Block als `Status` ohne Rahmen und Pfeil. Raster
`repeat(auto-fill, minmax(min(100%, 240px), 1fr))`; `auto-fill` hält leere Spuren, eine einzelne
Kachel wird also nicht fensterbreit. Die Fokusrückgabe sucht weiter den Knopf in der Kachel.

*Verworfen:* eine neue Stufe 18 px für den Rufnamen. Sie wäre die einzige zwischen 14 und 22 und
änderte die Skala für eine Stelle.

### D10 — Hinweis nach dem Wechsel

Eine Funktion `zeigeStatusQuittung(message, { rufname, vorher, neu, beleg, zuruecknehmen })` neben
`zeigeRueckgaengig` in `kommunikation/rueckgaengig.tsx`, Text „85-1: S2 → S3“, Knopf „Rückgängig“,
6 s, eigener Schlüssel je Fahrzeug, damit zwei schnelle Wechsel an zwei Fahrzeugen sich nicht
überschreiben. Die Mutation in `FahrzeugePage` (auch Tableau) und `FahrzeugeBesatzung` ruft sie
mit dem Beleg aus der Antwort. Antwortet die Rücknahme mit 409, zeigt der Hinweis „Nicht mehr
zurückzunehmen: inzwischen geändert“. antd-`message` nimmt keinen Fokus.

### D11 — Entwurf über das Design System

`Status`, `Marke` und der Statusknopf sind neue Bausteine: Nach `frontend/AGENTS.md` entsteht vor
dem Code ein Entwurf im Artifact-Typ „Design“ auf Grundlage des Design Systems, abgelegt unter
`docs/design/2026-11-18-status-baustein/`, mit Liste, Tableau-Kachel und Menü in Nacht und Tag. Die
Maße oben sind der Ausgangspunkt; weicht der Entwurf in einer Entscheidung ab, wird er vorgelegt.

## Risks / Trade-offs

- [Sehr breiter Diff, rund 250 Stellen in 150 Dateien] → Codemod für die mechanischen Fälle,
  Umstellung in Gruppen je Bereich mit grünen Tests zwischen den Gruppen; Review nach Ermessen
  wird wegen der Größe ausgelöst.
- [Fast alle Anwenderbilder ändern sich] → Bildlauf einmal am Ende, nicht je Gruppe.
- [e2e und Unit-Tests suchen `.ant-tag`, `status-chip`, `data-darstellung`] → neue stabile
  Attribute `data-lfh="status"` und `data-lfh="marke"` mit `data-ton`; die Tests ziehen mit.
- [Rücknahme scheitert an der Ablösungskopplung (422 aus `streiche_tx`)] → ganze Rücknahme als
  409, Hinweis im Wortlaut; Status bleibt neu, nichts halb geschrieben.
- [Mehrere Fahrzeuge einer Einheit] → nur das Ereignis, das der Server beim Wechsel dieses
  Fahrzeugs gemerkt hat, wird gestrichen.
- [Menüänderung trifft alle elf Abnehmer] → Kopf nur auf Wunsch; Höhenbegrenzung und Kippen sind
  für alle eine Verbesserung, e2e für Tablet und Handschuh.

## Migration Plan

Eine Migration (vier ADD COLUMN, nullable), rückwärts harmlos: Ältere Server ignorieren die
Spalten. Ein Rollback des Codes lässt sie stehen.
