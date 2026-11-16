# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/zo7em8lenuxcicpborwddhqx (LLH-1742, Teil von LLH-1717
„Was brennt sichtbar machen“)

## Why

Im Organigramm sieht der „kritische“ Abschnitt UHS Turnhalle aus wie jeder andere Knoten, denn
den Lagezustand zeigt nur die Gliederung, nicht das Organigramm. Laut ist dagegen etwas
anderes: An neun Knoten der Demo steht gelb „Leitung nicht besetzt“, an Abschnitten ohne
Abschnittsleiter und an Einheiten ohne Führer. Das Kritische ist leise, eine vielfach
wiederholte Lücke laut. Wer das Organigramm liest, um sich die Lage anzusehen, findet den
kritischen Abschnitt nicht.

## What Changes

- Ein Abschnittsknoten zeigt seinen Lagezustand (planmäßig, angespannt, kritisch) als Etikett in
  derselben Form wie Gliederungsbaum und Überblick: Rand in der Rolle der Stufe, dazu das Wort.
  Ein nicht beurteilter Abschnitt trägt kein Etikett. Gezeigt wird nur der eigene Zustand, denn
  die Unterabschnitte stehen sichtbar darunter.
- „Leitung nicht besetzt“ bleibt als Wort am Knoten, steht aber gedämpft statt in Achtungrolle.
- Über dem Organigramm fasst eine Sammelzeile die Lücken zusammen, je Art ein Etikett in
  Achtungrolle: „2 Abschnitte ohne Leitung“, „7 Einheiten ohne Führer“. Ein Teil mit 0 entfällt.
  Sind alle besetzt, steht dort leise „Leitung überall besetzt“. Fehlen die Einheiten, zählt die
  Zeile nur die Abschnitte. Die Zeile ist immer gleich hoch, damit sie den Baum nie verschiebt.
- Druck und „In Lagebericht übernehmen“ tragen beides: der Druck wie der Bildschirm, der Bericht
  mit „Lage <Zustand>“ an der Abschnittszeile und, wenn eine Leitung fehlt, der Sammelzeile unter
  „Gliederung“.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `fuehrungsorganisation`: Knoteninhalt (Lagezustand am Abschnittsknoten, „Leitung nicht
  besetzt“ ohne Warnrolle), neue Sammelzeile der fehlenden Leitung, Übernahme in den Lagebericht
  mit Lagezustand und Sammelzeile.

## Impact

- Frontend: `frontend/src/pages/einsatzabschnitte/fuehrungsorganisation.ts` (Modell, Zählung,
  Markdown) und `Organigramm.tsx` (Etikett, Sammelzeile, gedämpftes Wort) samt Tests.
- Der Lagevortrag übernimmt die „Eigene Lage“ mit demselben Text
  (`frontend/src/lageberichte/eigeneLageUebernahme.ts`, Spec `lagevortrag-uebernahme`): Lagezustand
  und Sammelzeile stehen damit auch dort.
- Kein Backend, keine API, keine Migration: der Lagezustand liegt schon am Abschnitt
  (`Einsatzabschnitt.lagezustand`, LFH-608).
- Anwenderdoku: Kapitel `docs/anwender/kapitel/einsatzabschnitte.md`, Abschnitt „Das
  Organigramm“, und das Bild `organigramm.png` (Mitänderungsregel).
- Die Fernmeldeskizze teilt das Gerüst `HaengenderBaum`; sie bleibt unberührt, denn die
  Änderung liegt im Knoteninhalt und außerhalb des Gerüsts.
