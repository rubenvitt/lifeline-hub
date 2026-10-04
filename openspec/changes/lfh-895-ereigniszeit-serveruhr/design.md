# Design

## Context

Motivation: `proposal.md`, „Why“. Darauf baut die Änderung auf:

- `serverJetzt()` (`frontend/src/offline/serveruhr.ts`, LFH-705) liefert „jetzt“ nach der
  Serveruhr. Der Versatz kommt aus dem `Date`-Header jeder eigenen API-Antwort, gilt 24 h,
  liegt auch in `localStorage` und wird unter 5 s Abweichung nicht angewendet. Ohne frischen
  Versatz gibt `serverJetzt()` die Geräteuhr zurück. Herleitung:
  `openspec/changes/archive/2026-10-01-lfh-705-serveruhr-versatz-offline/design.md`.
- **ETB:** `Schnellerfassung.tsx` nimmt beim Absenden `jetztIso = new Date().toISOString()`
  (vor dem Upload der Anhänge, damit ein langer Upload die Zeit nicht verschiebt).
  `baueEintrag` setzt daraus `ereigniszeit` (wenn kein Zeit-Chip gesetzt ist) und
  `erfasst_lokal_at`. Online wie offline geht dieselbe Nutzlast hinaus (`useEtbErfassung`).
  Der Zeit-Chip (`MetaChip.tsx`) öffnet seinen Editor mit `defaultValue = dayjs()`.
- **Meldung:** `MeldungFormular.tsx` sendet `alsBackendZeit(w.ereigniszeit ?? dayjs())`; das
  Feld zeigt „leer = jetzt“. Der Server rechnet `faellig_at` = Ereigniszeit + Frist.
- **Zeiteingabe:** `ZeitpunktEingabe.tsx` hat einen eigenen Knopf „Jetzt“, der `dayjs()`
  setzt (antds browserlokales „Jetzt“ ist aus, LFH-692).
- **Server:** `routes/etb.rs` und `routes/meldung.rs` normalisieren die Ereigniszeit nur. Eine
  fehlende ETB-Ereigniszeit füllt die Datenbank mit ihrem Default. Betreuung (60 s) und
  Kräfte-Zeitachse (`UHRENTOLERANZ_MINUTEN` = 2) lehnen Zukunft ab.

## Goals / Non-Goals

**Goals:**
- „Jetzt“ heißt beim Erfassen überall dieselbe Uhr: die des Servers, soweit bekannt. Das gilt
  für die stille Vorgabe und für jeden Vorschlag, den die Person sieht.

**Non-Goals:**
- **Laufende Anzeigen** („vor 3 min“, Countdown einer Bestätigungsfrist, „überfällig“,
  Lesemarke) rechnen weiter mit der Geräteuhr. Das ist ein Anzeigefehler auf einem falsch
  gehenden Gerät, aber kein falsch gespeicherter Wert, und berührt ein Dutzend Stellen.
- **Kalendergrenzen** der Zeiteingabe („keine Zukunftstage“, „heute“) bleiben bei der
  Geräteuhr. Ein Vorlauf von Minuten verschiebt sie nur kurz vor Mitternacht.
- **Server:** keine Änderung (D4).
- **Bestehende Daten** werden nicht korrigiert. Der Versatz eines Geräts zur Zeit eines alten
  Eintrags ist unbekannt.

## Decisions

### D1 — Die Vorgabe „jetzt“ nimmt `serverJetzt()`, der eingetragene Wert bleibt

`Schnellerfassung.tsx` nimmt `jetztIso` aus `serverJetzt()` statt aus `new Date()`, weiter vor
dem Upload. `MeldungFormular.tsx` ersetzt `dayjs()` im Rückfall durch `serverJetzt()`. Ein
gesetzter Zeit-Chip oder ein ausgefülltes Feld geht unverändert hinaus: Die Person hat diesen
Zeitpunkt gewählt, und eine stille Umrechnung machte aus „09:30“ eine Zeit, die sie nie
eingegeben hat (dieselbe Abwägung wie LFH-705, D5).

**Verworfen: online die Ereigniszeit weglassen**, damit der Server sie stempelt. Das ginge nur
für das ETB (die Meldung verlangt das Feld), es stempelte den Empfang statt des Absendens
(ein langer Upload verschöbe sie wieder), und ein vorgemerkter Eintrag braucht ohnehin einen
Zeitpunkt vom Gerät. Zwei Wege für denselben Wert wären mehr Fläche für weniger Wirkung.

### D2 — `erfasst_lokal_at` folgt derselben Uhr

`erfasst_lokal_at` ist laut Schema „beratend (Client)“. Sein Nutzen ist der Abstand zu
`received_at` (wie lange war der Eintrag unterwegs); den misst nur, wer beide auf derselben
Uhr hat. Er bleibt deshalb wie heute derselbe Wert wie die vorbelegte Ereigniszeit.

**Verworfen: `erfasst_lokal_at` roh nach der Geräteuhr** als Nachweis des Uhrenfehlers. Der
Wert vermischt Uhrenfehler und Ausfalldauer und taugt für keins von beiden; niemand liest ihn
dafür.

### D3 — Was die Person sieht, kommt von derselben Uhr wie die Vorgabe

Die offene Frage des Tickets („darf die Anzeige von der Geräteuhr abweichen?“) entscheidet
sich so: Die Vorgabe selbst sieht niemand (ETB ohne Chip, Meldung „leer = jetzt“). Sichtbar ist
nur ein **Vorschlag**: der Editor des Zeit-Chips und der Knopf „Jetzt“. Beide nehmen
`serverJetzt()`. Dann ergibt „Chip öffnen, OK“ denselben Zeitpunkt wie „Chip weglassen“, und
die Oberfläche zeigt beim Erfassen dieselbe Uhr wie überall sonst: Alle gespeicherten Zeiten,
die die App anzeigt (`received_at`, Fristen, Zeitachse), stammen ohnehin vom Server.

Der Vorschlag weicht dann von der Uhr in der Statusleiste des Geräts ab, und zwar um genau
deren Fehler. Das ist gewollt: Die Serveruhr liegt näher an Funkuhr und Wanduhr als ein
Handschirm, dessen Uhr Minuten vorgeht.

`ZeitpunktEingabe` ist ein gemeinsamer Baustein. Sein „Jetzt“ wirkt also in jeder Zeiteingabe.
Das ist beabsichtigt: In Betreuung und Kräfte-Zeitachse lehnt der Server Zukunft ab, und ein
„Jetzt“ auf einem Gerät mit 5 min Vorlauf scheitert dort heute mit 400/422.

**Verworfen: Vorgabe nach Serveruhr, Vorschlag nach Geräteuhr.** Dann lieferten „Chip
weglassen“ und „Chip öffnen, OK“ zwei Zeiten, die um den Uhrenfehler auseinanderliegen, und
der zweite Weg datierte weiter zu spät.

### D4 — Kein Zukunftsriegel im Server

Der Server begrenzt ETB- und Meldungs-Ereigniszeiten weiter nicht.

1. **Ohne bekannten Versatz gilt die Geräteuhr** (frischer Start ohne Netz, Proxy ohne
   `Date`). Ein Riegel ließe genau diese Einträge scheitern. Heute kommen sie an, nur zu spät
   datiert; danach lägen sie abgelehnt im Wiederherstellungs-Drawer. Für das ETB, die
   Beweissicherung des Einsatzes, ist „zu spät datiert und als nachgetragen markiert“ das
   kleinere Übel als „nicht erfasst“.
2. Der Riegel heilte nichts: Die Fehldatierung behebt D1, der Riegel fände nur die Fälle, die
   D1 nicht erreicht, und machte sie schlimmer.
3. Eine Meldungs-Ereigniszeit in der Zukunft hat heute keinen Weg in die Oberfläche außer
   einer Handeingabe; die eigene Wahl einer Person abzulehnen ist eine eigene fachliche
   Entscheidung (vorausdatierte Meldung), kein Teil dieses Befunds.

**Verworfen: Kappen auf „jetzt“** im Server (wie in LFH-705, D1 verworfen): bricht die
Reihenfolge und kann einen Handwert nicht von einer Vorgabe unterscheiden.

## Risks / Trade-offs

- [Die Geräteuhr springt zwischen Messung und Absenden] → Die Vorgabe ist um den Sprung
  falsch; die nächste Antwort des Servers heilt das. Nicht schlechter als heute.
- [Eine Zeiteingabe setzt mit „Jetzt“ eine Zeit, die von der Gerätestatusleiste abweicht] →
  Gewollt (D3); die Abweichung ist der Uhrenfehler des Geräts.
- [Ein Test einer anderen Seite drückt „Jetzt“ und erwartet `dayjs()`] → Im Test ist kein
  Versatz gemessen, `serverJetzt()` gibt dann die Geräteuhr; Bestandstests bleiben gleich.

## Migration Plan

Nur Frontend. Kein Schema, keine API, keine Queue-Version: Vorgemerkte Einträge tragen wie
bisher fertige Zeiten. Rückbau ist das Zurückdrehen des Frontends.
