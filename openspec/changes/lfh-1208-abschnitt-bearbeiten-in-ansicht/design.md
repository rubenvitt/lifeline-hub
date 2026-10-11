# Design

## Context

Den Anlass beschreibt proposal.md, die Anforderungen stehen in
`specs/einsatzabschnitt-bearbeitung/spec.md`.

Heute:

- `pages/EinsatzabschnittePage.tsx` hält zwei Zustände im Detailpaneel. Im Lesezweig steht
  `AbschnittDaten` mit den Knöpfen „Bearbeiten“ und „Auflösen“. Im Schreibzweig ersetzt ein
  antd-`Form` mit elf Feldern das Detail, sowohl für „Bearbeiten“ als auch für den lokalen
  Entwurf „Neuer Abschnitt“. Gespeichert wird über `aktualisiereAbschnitt` mit dem vollen Stand
  vom Öffnen (Zeilen 230–248), oder über `legeAbschnittAn`.
- `api/einsatzabschnitte.ts` kennt schon `patcheAbschnitt` (LFH-306, Tri-State: nur übergebene
  Schlüssel, `null` leert). Die Fernmeldeskizze nutzt es für Kurzbezeichnung und
  Kommunikationsmittel.
- `pages/einsatzabschnitte/AbschnittDaten.tsx` liest an drei Stellen: im Detail der Seite, in der
  Abschnittsvorschau der Sprungpalette (`AbschnittVorschau.tsx`) und in der Funktionsansicht
  `geraet/GeraetAbschnittPage.tsx`. Die beiden letzten zeigen nur und bleiben so.
- Das Vorbild ist `pages/EinsatzdatenPage.tsx` (LFH-839/LFH-472). Jede Zeile ist dort eine
  `InlineAngabe`, ein Speichern schickt über `patcheEinsatz` ein Feld, der Fehler steht in der
  Zeile. Sprechgruppen und Kommunikationsmittel der Führungsstelle sind dort schon als
  `InlineAngabe` mit `SprechgruppenPicker` bzw. `Select` gebaut.
- Der Server schreibt bei einem Wechsel des Lagezustands einen System-Eintrag ins ETB. Das bleibt
  unverändert.

## Goals / Non-Goals

**Goals:**

- Ein Detail, das liest und bearbeitet, mit genau einem Feld je PATCH.
- Den Lagezustand mit einem Klick setzen.
- Anlegen in höchstens drei Feldern über die Erfassungs-Norm.
- Fortschritt aus jeder Oberfläche nehmen, ohne Server und Daten anzufassen.

**Non-Goals:**

- **Über-Abschnitt per Ziehen in der Gliederung.** Das ist ein eigenes Ticket desselben
  Sammeltickets. Bis dahin bleibt „Über-Abschnitt“ eine Zeile im Detail.
- **Begriff „Erreichbarkeit / Nummer“.** Die Zeile bleibt unverändert, bis Querschnitt (e) aus
  LFH-1162 den Begriff klärt.
- **Sammelbanner „an anderem Arbeitsplatz geändert“** im Detail. Eine offene Zeile behält ihren
  Entwurf, die übrigen Zeilen zeigen den neuen Serverstand. Weil jede Zeile nur ihr eigenes Feld
  schickt, geht keine fremde Änderung verloren. Ein Banner ist eine eigene Entscheidung.
- **Entfernen der Spalte `fortschritt`.** Tabelle, DTO, PATCH und Codegen bleiben. Das Löschen
  folgt in einem späteren Aufräum-Ticket mit Migration.
- **Prüfung der Funktionsansicht auf Bearbeitung.** `GeraetAbschnittPage` bleibt reine Ansicht.

## Decisions

### D1 · Eigenes Bauteil für das bearbeitbare Detail, `AbschnittDaten` bleibt reine Ansicht

Für das Detail der Seite entsteht `pages/einsatzabschnitte/AbschnittDetail.tsx`. Es trägt dasselbe
`Datenraster` mit denselben Etiketten, aber jede Zelle ist eine `InlineAngabe` bzw. beim
Lagezustand eine Segmentleiste. `AbschnittDaten` bleibt das Lesebauteil für Vorschau und
Funktionsansicht und verliert nur den Fortschritt.

*Alternative:* `AbschnittDaten` bekommt eine optionale Bearbeitungs-Prop und schaltet je Zelle
zwischen Lesen und `InlineAngabe` um. Das hielte die Reihenfolge an einer Stelle. Dafür bekämen
Palette und Gerät Abhängigkeiten auf Personal, Sprechgruppen und Mutationen, die sie nie nutzen,
und jede Zelle bekäme eine zweite Weiche. Verworfen. Stattdessen pinnt ein Test die Etiketten-Folge des Details und
belegt für beide Bauteile, dass kein Fortschritt erscheint. Das Lesebauteil fasst Funk und
Erreichbarkeit weiter in einer Zelle zusammen.

### D2 · Teil-Patch je Zeile über `patcheAbschnitt`, eine Mutation mit Feldkennung

Die Seite hat eine Mutation `patch` (Bezeichner-Sprache: Technik englisch) mit den Variablen `{ aid, etikett, patch }`. Jede Zeile ruft
`mutateAsync`. `InlineAngabe` wartet, zeigt die Ablehnung selbst an der Zeile und lässt die
Eingabe offen. Einen `onError`-Toast gibt es nicht (Regel „Speicherfehler an die Seite“). Bei
Erfolg invalidiert sie Abschnitte, Einheiten und ETB wie heute. Ein Erfolgs-Toast nennt die
Angabe („Lagezustand gespeichert“), so wie auf den Einsatzdaten. `aktualisiereAbschnitt` hat danach
keinen Aufrufer mehr und entfällt. Die neue Seite kann den vollen Stand also nicht mehr schicken.

Leer heißt `null`. Freitexte werden getrimmt, leer ergibt `null`. `leiter_id`,
`ueber_abschnitt_id` und `kommunikationsmittel` setzen beim Leeren `null`, `sprechgruppe_ids`
wird `[]`.

Alle Zeilen nehmen `InlineAngabe`, auch die optionalen Freitexte (Abschnittsauftrag,
Erreichbarkeit, Bemerkung). Das weicht vom Ticket ab, das dafür `BemerkungZelle` vorschlug.
`BemerkungZelle` ist für Listenzellen gebaut und speichert beim Verlassen. Im Detail gilt wie auf
den Einsatzdaten ein Vertrag für alle Zeilen: Speichern/Abbrechen, Fehler an der Zeile, und eine
leere Angabe zeigt „… eintragen“.

*Alternative:* ein Formular, das nur die geänderten Felder sendet (Muster LFH-979). Verworfen,
weil das Langformular gerade wegfallen soll.

### D3 · Name als Pflichtzeile im Raster, nicht als Umbenennen-Knopf am Titel

Der Name steht als erste Zeile im Datenraster (`InlineAngabe pflicht`). Der Paneeltitel bleibt
„Abschnitt: <Name>“, denn darauf stützen sich Region-Namen in Tests und Bildern.

*Alternative:* `ausloeser` „Umbenennen“ im `aktion`-Slot des Paneelkopfs, wie bei den
Gefahrengebieten (LFH-969). Die Eingabe stünde dann im Paneelkopf neben Meta und Titel und
bräche dessen feste Höhe. Verworfen. Die doppelte Nennung im Titel und in der Zeile nehmen wir
hin.

### D4 · Lagezustand als `Segmentleiste` mit vier Stufen, Wechsel speichert sofort

Die Zeile Lagezustand trägt mit Schreibrecht eine `Segmentleiste` (`rolle="radiogroup"`,
`beschriftung="Lagezustand"`). Die Optionen sind `nicht_beurteilt` (ohne Punkt), `planmaessig`,
`angespannt` und `kritisch`. Wortlaut und Punktfarbe kommen aus `abschnittLagezustand` im
Farbvertrag (`rollenFarbe`), nicht doppelt. `nicht_beurteilt` ist ein Wert nur der Oberfläche.
Die Seite bildet ihn auf `lagezustand: null` ab, denn die Leiste kennt kein `null`.

Ein Wechsel ruft `patch` sofort. Bis zur Antwort zeigt die Leiste die gewählte Stufe
(lokaler Wert), bei Ablehnung springt sie auf den Serverstand zurück, und der Grund steht als
`ZeilenFehler` unter der Leiste. Es ist immer nur eine Anfrage unterwegs, sonst könnte eine ältere
Antwort eine jüngere Wahl überholen. Eine Wahl währenddessen wird gemerkt und angezeigt (Häkchen
und Fokus stimmen überein); nach der Antwort geht die jeweils letzte hinaus, wenn sie vom
Gesendeten abweicht. Ein erster Entwurf verwarf sie still; das Review fand, dass der Fokus dann
auf einer nicht gewählten Stufe stand.
Pfeiltasten wählen in der Segmentleiste schon heute (APG), jede Wahl speichert also. Das ist
gewollt: ein Schritt ist ein Wechsel, und der Server schreibt je Wechsel einen ETB-Eintrag.

Ohne Schreibrecht steht der Lagezustand wie heute als `StatusTag` bzw. „nicht beurteilt“.

*Alternative:* `StatusWahl` (senkrechtes Menü am Status). Das braucht zwei Klicks und verdeckt die
übrigen Stufen. Der Lagezustand hat nur vier Stufen und wechselt am häufigsten, deshalb verworfen.
*Alternative:* Pfeiltasten wandern nur, Leertaste wählt. Das wiche vom Baustein ab, der überall
sofort wählt, und brauchte eine Sonderform. Verworfen. Die vielen ETB-Einträge, die so entstehen
können, stehen unter Risiken.

### D5 · Kurzbezeichnung prüft vor dem Senden in `onSpeichern`

`InlineAngabe` hat keine Feldprüfung. Die Zeile Kurzbezeichnung prüft deshalb in `onSpeichern` mit
derselben NOCASE-Vergleichsform wie heute (`nocase`, aus der Seite in ein kleines reines Modul
`pages/einsatzabschnitte/kurzbezeichnung.ts` gezogen). Ist die Bezeichnung vergeben, lehnt die
Zusage mit `ApiError(409, 'Schon vergeben (<Name>)')` ab, ohne Anfrage: dieselbe Ablehnung, die der
Index des Servers gäbe, und nur deren Meldung zeigt die Zeile wörtlich. `InlineAngabe` zeigt das wie
jede Ablehnung an der Zeile. Das Anlegen-Modal nutzt dieselbe Funktion als Feldregel.

*Alternative:* eine `pruefe`-Prop an `InlineAngabe`. Ein neuer Baustein-Vertrag für einen einzigen
Aufrufer, deshalb verworfen. Kommt ein zweiter dazu, wird die Prüfung dorthin gezogen.

### D6 · Anlegen über `ErfassungsModal`, drei Felder, danach gewählt

`pages/einsatzabschnitte/AbschnittAnlegenModal.tsx` nutzt `ErfassungsModal` mit den Feldern
Name (Pflicht, Fokus), Kurzbezeichnung (Regel aus D5) und Über-Abschnitt (`TreeSelect`, alle
Abschnitte). `onErfassen` ruft `legeAbschnittAn` per `mutateAsync` mit genau diesen Feldern. Bei
Erfolg setzt die Seite `gewaehlt` auf die neue `id` und die Ansicht auf `gliederung`. Kopfknopf,
Leeraktionen beider Ansichten und `?neu=1` öffnen das Modal. `?neu=1` wird wie heute nur bei
Schreibrecht wirksam und immer aus der URL geräumt.

Weil ein `TreeSelect` Enter schluckt, prüft der Test die Struktur der Erfassungs-Norm: Absende-Knopf
im `<form>`, keine `.ant-modal-footer`. Enter im Namen sendet.

Damit entfallen der lokale Entwurf, `entwurf`/`bearbeiten` als Seitenzustand, der Baumknoten
„Neuer Abschnitt (ungespeichert)“ und die Spiegelung in `useQueryParamSelektion`. Die Regel
„Abschnitt anlegen ist ein lokaler Entwurf, kein Fake-Datensatz“ wird zu: „Abschnitt anlegen“ ist
eine Erfassung (`ErfassungsModal`, drei Felder), den Datensatz gibt es erst nach dem Absenden,
der Rest wird im Detail ergänzt.

### D7 · Fortschritt nur in der Oberfläche entfernen

`AbschnittDaten` verliert die Zeile, `ueberblickDaten.ts` das Feld `fortschritt` der
Abschnittszeile, `UeberblickPage.tsx` den Balken (`data-lfh="abschnitt-fortschritt"`). Die
Abwesenheit wird getestet. Kommentare, die den Fortschritt als Beispiel nennen
(`instrument/Aufgliederung.tsx`: „S2 Abschnittsfortschritt“), werden mitgezogen. `AbschnittEingabe`
behält `fortschritt` mit dem Vermerk „nur Altdaten, die Oberfläche schreibt ihn nicht (LFH-1208)“,
weil die API ihn weiter trägt. Da jede Zeile ein Feld schickt, bleibt ein Altwert unberührt.

### D8 · Kein Verlassen-Schutz

Das Detail speichert jede Zeile für sich wie `EinsatzModule` und die Einsatzdaten-Zeilen. Es ist
keine Formularseite mit Leiste, die Regel „Formularseiten mit Leiste tragen den Verlassen-Schutz“
greift also nicht mehr. Damit erledigt sich der Befund „kein Verlassen-Schutz am Formular“.

## Risks / Trade-offs

- [Pfeiltasten in der Lagezustand-Leiste schreiben je Schritt einen ETB-Eintrag] → Schritte
  während einer laufenden Anfrage fallen zu einer zusammen (nur die letzte geht hinaus). Die Leiste hat vier Stufen, und wer mit
  Pfeilen wandert, landet in höchstens drei Schritten am Ziel. Häufen sich im Feld solche
  Zwischeneinträge, kommt ein Nachzug, der Pfeile nur wandern lässt.
- [Ein Fehlklick auf „kritisch“ wirkt sofort und steht im ETB] → So ist es gewollt: ein Klick,
  ohne Rückfrage. Ein zweiter Klick nimmt den Wechsel zurück, und das ETB dokumentiert beides.
  Das entspricht dem, was im Einsatz tatsächlich geschah.
- [Zwei Bauteile zeigen dieselben Angaben (D1)] → Ein Test pinnt Etiketten und Reihenfolge beider.
- [Gewohnte Bedienung „Bearbeiten“ fällt weg] → Das Anwenderkapitel und seine Bilder werden neu
  geschrieben. Die Hilfe in der App zeigt den neuen Weg.
- [Das Anlegen-Modal zeigt keinen Lagezustand mehr] → Wer beim Anlegen schon eine Lage kennt,
  braucht einen Klick mehr im Detail. Das bleibt im Feldbudget von drei Feldern.

## Migration Plan

Nur Frontend, keine Migration. Rückweg: Revert des PRs. Daten ändern sich nicht, Altwerte von
`fortschritt` bleiben in der Datenbank.
