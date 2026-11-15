# Design

## Context

`instanz::repo::wird_erreicht` entscheidet über Sperre und Verfügbarkeit des Einspielens
(`src/routes/archiv_einspielen.rs`, `fordere_keinen_hub` und `verfuegbarkeit`). Sie fragt, ob in
`instanz_kopplung` eine Zeile mit `richtung = 'wird_gemeldet'` und `zustand IN ('angebahnt',
'aktiv')` steht (Herleitung: `openspec/changes/archive/2026-11-14-yftpw99d-archiv-einspielen-verwaltung/design.md`, D3).
Seit Migration 0336 trägt jede Kopplung eine Art (`art`, `standard` oder `vor_ort`, Vorgabe
`standard`). Die ausstellende Seite einer Direktkopplung vor Ort führt ihre Zeile mit `richtung =
'wird_gemeldet'`, also zählt sie heute mit. Motivation: siehe proposal.md, „Why“.

## Goals / Non-Goals

**Goals:**

- Eine Direktkopplung vor Ort macht keine Instanz zum Hub.
- Die Sperre bleibt im Zweifel geschlossen.

**Non-Goals:**

- Andere Verwendungen von `richtung = 'wird_gemeldet'` (Stammdaten, Geheimnisse, Verwahrung,
  Führungswechsel) bleiben unberührt; sie fragen `InstanzKopplungArt::traegt`.
- Keine Sperre je Organisation, kein neuer Zustand, keine Migration.

## Decisions

### D1 Ausnahme statt Positivliste: `art <> 'vor_ort'`

`wird_erreicht` ergänzt die Bedingung um `art <> 'vor_ort'`. Heute ist das gleichwertig mit
`art = 'standard'`. Kommt später eine dritte Art dazu, sperrt sie, bis jemand sie bewusst
ausnimmt. Ein privater Schlüssel an einer Installation, die doch erreicht wird, wiegt schwerer als
ein Admin, der vorübergehend zum Befehl greifen muss. Abgestimmt mit Ruben am 14.11.2026.

- **Verworfen: `art = 'standard'`** (Vorschlag der Aufgabe): eine künftige Art wäre
  stillschweigend frei.
- **Verworfen: über `InstanzKopplungArt::traegt` entscheiden.** Die Sperre schützt keinen Fluss,
  sondern den Ort des Schlüssels; einen eigenen `Fluss` dafür einzuführen, verwischt die
  Bedeutung von `traegt` (was über eine Kopplung fließt).

### D2 Nur die erreichte Seite zählt, also bleibt die Richtung

Die einlösende Seite einer Direktkopplung führt `richtung = 'meldet_sich'` und war nie gesperrt.
Die Ausnahme betrifft deshalb nur die ausstellende Seite. „Gleich in welcher Richtung“ aus der
Aufgabe ist damit erfüllt, ohne die Richtungsbedingung zu lockern.

### D3 Text der Ablehnung

Die Meldung „An dieser Installation meldet sich eine andere Instanz …“ bleibt sinngemäß und
nennt, dass eine Direktkopplung vor Ort nicht zählt, damit ein Admin mit beiden Kopplungen die
Ursache findet.

## Risks / Trade-offs

- [Ein ELW mit Direktkopplung ist im lokalen Netz für den zweiten ELW erreichbar] → Die
  Direktkopplung ist auf ein Einsatznetz beschränkt, Nutzdaten laufen nur über das gepinnte
  Zertifikat (`src/AGENTS.md`, „Backend — Instanzkopplung“). Das ist nicht die öffentliche Erreichbarkeit, gegen
  die ADR-0045 schützt.
- [Wird während des Einspielens eine Standardkopplung angebahnt] → unverändert wie in D3 der
  Herleitung: das Fenster ist ein Request lang.

## Migration Plan

Keine Datenänderung. Wirkt mit dem Update; Rückweg ist das vorige Binary.
