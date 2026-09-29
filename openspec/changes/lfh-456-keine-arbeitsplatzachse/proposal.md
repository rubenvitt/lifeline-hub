# Proposal

## Why

Die Bedienung hat zwei verankerte Achsen: **Form** (LFH-19) und **Kontext** (LFH-327). Mit der
Aufnahme-Route aus LFH-340/C5 gibt es die erste Fläche, die nach Aufgabe statt nach Modul
geschnitten ist. Das wirft die Frage auf, ob fachliche Arbeitsplätze (Aufnahme, Sichtung,
Transport, UHS-Leitung, Bereitstellungsraum, Führungsassistenz) eine dritte Achse brauchen.
Ohne festgehaltene Antwort wird sie an jeder weiteren solchen Fläche neu verhandelt (LFH-456).

Entschieden am 29.09.2026: **keine dritte Achse** (Variante 1 aus LFH-456).

## What Changes

- Festgehalten wird: Es gibt keine Bedienachse „Arbeitsplatz“. Arbeitsplatz-Flächen sind
  Einzelfälle. Man erreicht sie über **Einstiege**: Primäraktion im Seitenkopf, Sprungmarke,
  Leeraktion eines Paneels, Sprungpalette sowie Deeplink bzw. Lesezeichen am Gerät. Was am
  Gerät hängt, trägt die Kontext-Achse aus LFH-327.
- Festgehalten wird auch die **Nicht-Zuständigkeit**: Rechte und Datensichtbarkeit kommen
  weiter allein aus `EinsatzRolle` und `einsatz/schreibrecht.ts`. Keine Arbeitsplatzangabe
  verändert sie, und keine Rolle formt Startziel, Primäraktion oder Modulreihenfolge.
- Benannt werden die fachlichen Arbeitsplätze mit ihrem heutigen Einstieg. Wo es keinen gibt
  (Transportorganisation), steht das als Lücke da und wird nicht erfunden.
- Durchgespielt wird der Fall `/einsaetze/:id/personen/aufnahme`. Die zwei Einstiege aus
  UHS-Kopfzeile und Sichtungspaneel reichen. Die Sprungpalette bekommt keinen eigenen
  Aufnahme-Eintrag.
- Neu ist ein Absatz in `CLAUDE.md` neben „UI-Form-Leitlinie“ und „Bedien-Leitlinie“ mit
  Verweis auf diese Herleitung.
- Kein Projektcode, keine Migration, kein Codegen.

## Capabilities

### New Capabilities

- `bedien-arbeitsplatz`: Wie fachliche Arbeitsplätze in der Bedienung vorkommen, nämlich als
  Einstiege und nicht als Achse, und was eine Arbeitsplatzangabe ausdrücklich nicht darf.

### Modified Capabilities

(keine)

## Impact

- `CLAUDE.md`: neuer Absatz im Frontend-Teil.
- `openspec/specs/bedien-arbeitsplatz/spec.md` (nach dem Archivieren).
- Code: keiner. Das spezifizierte Verhalten besteht schon. Belege sind
  `pages/uhs/UhsDetailPage.test.tsx` (LFH-341 · H38) und die Tests des Überblicks für die
  Leeraktion „Person aufnehmen“.
- ClickUp: LFH-456 wird mit Variante 1 abgeschlossen, ohne Folge-Tasks.
