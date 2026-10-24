# Design

## Context

Der Formatkern liegt unter `frontend/src/anzeige/`. Eine Zeitangabe trägt eine von drei Rollen
(„Zeitpunkt“, „kurz“, „Uhrzeit“) und erscheint in der wirksamen Darstellung: zuerst die Gerätewahl,
dann der Einsatz, dann die Organisation (Spec `zeitdarstellung`). Vier Stellen bauten ihre Uhrzeit
selbst mit `formatiere(…, 'HHmm')` oder eigenen Helfern. Der Wächter sucht nur nach `.format(`. Er
fand dabei eine fünfte Stelle, den Erfassungs-Chip des ETB.

## Goals / Non-Goals

**Goals:**
- Jede angezeigte Uhrzeit folgt der Zeitdarstellung, auch eine ohne Datum.
- Der Wächter schließt den Umweg über `formatiere(` mit Zeit-Token.

**Non-Goals:**
- Eingabefelder umstellen. Sie bleiben taktisch („0600 1800“), wie es die Spec `zeiteingabe` für
  die Eingabe vorsieht.
- Den Servertext der Schichtmodelle umstellen. `src/schichtmodell/mod.rs` schreibt die Regel ins
  ETB immer als „Wechsel 06:00/18:00“. Das folgt nicht der Darstellung des Einsatzes, wie die Spec
  „Servertexte“ es verlangt, und läuft als eigene Folgeaufgabe.
- Weitere Verwaltungsseiten ohne `OrgAnzeigeProvider` umhüllen. Nur die beiden betroffenen Tabs
  bekommen ihn.

## Decisions

### D1 — Eigene Kernfunktion für Uhrzeiten ohne Tag

`uhrzeitOhneDatum(hhmm, konv)` gibt `1430` bzw. `14:30` aus, ohne Zonenrechnung, wie
`kalendertag`. Eine Wanduhrzeit ohne Tag hat keine Zone. Rechnete man sie über einen Zeitpunkt,
verschöbe eine Zeitumstellung die Anzeige.

### D2 — Anzeige und Eingabe in `abloesung/dauer.ts` getrennt

`formatUhrzeiten(zeiten, konv)` ist nur noch die Anzeige. Das Eingabefeld belegt
`uhrzeitenFeldText(zeiten)` vor, unverändert taktisch (`schichtmodellForm.ts`). `formatRegel` und
`formatRegelKurz` nehmen `konv`.

### D3 — Der vorgeschlagene Titel folgt der wirksamen Darstellung samt Gerätewahl

Der Titel ist ein vorgeschlagener Text, den der Mensch vor dem Speichern sieht und ändern kann.
Er folgt deshalb wie die Platzhalter `{datum}`/`{uhrzeit}` eines ETB-Bausteins (LLH-1061,
`etb/BausteinPlatzhalterModal.tsx`) der wirksamen Darstellung, die Gerätewahl eingeschlossen. Im
Druck zählt die Gerätewahl weiterhin nicht.

Alternative (offen zur Freigabe): Der Titel folgt nur Einsatz und Organisation, wie die Servertexte
(E4 aus LLH-1045). Dann sähe jeder Bearbeiter denselben Vorschlag, und ein gespeicherter Titel
hinge nicht an den Vorlieben des Geräts, auf dem er entstand. Das wäre eine kleine Änderung
(`konventionen` ohne Gerätewahl durchreichen).

### D4 — Wächter erweitert statt Ausnahmeliste

Der Wächter erkennt `formatiere(…)` mit einem Zeit-Token in irgendeinem Argument, auch in einem
Bedingungsausdruck. `YYYY-MM-DD`, das Koordinaten-`formatiere(lat, lon, 'mgrs')` und
`formatiereUhr` zählen nicht. Die Schuldmenge `OFFEN` bleibt leer. Ein Selbsttest belegt, dass ein
neues `formatiere(x, 'HHmm')` in `lageberichte/` rot macht.

## Risks / Trade-offs

- **Gespeicherte Titel tragen die Form ihres Entstehens (D3):** Ein Lagevortrag, der auf einem Gerät
  mit „Datum und Uhrzeit“ angelegt wurde, heißt „Lageüberblick 14:30“, auf einem anderen
  „Lageüberblick 1430“. Abhilfe wäre die Alternative in D3.
