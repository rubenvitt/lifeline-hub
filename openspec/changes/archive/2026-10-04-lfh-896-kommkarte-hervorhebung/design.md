# Design

## Context

Motivation: siehe `proposal.md`. Anforderungen: `specs/deeplink-hervorhebung`.

Ist-Stand:

- `kommunikation/KommKarte.tsx` setzt bei `hervorgehoben` inline
  `boxShadow: 0 0 0 2px ${rollen.bedien}`, einen äußeren Ring. Die Karte trägt außerdem
  `border: 1px solid linie`, links `borderInlineStart: 3px` in der Kantenfarbe
  (`kartenKante`: `alarm` vor `achtung` vor `linie`) und als Grund `alarmFlaeche` bei Alarm,
  sonst `paneel`. Sie liegt nicht in einer Datensicht und trägt die Klasse
  `.zeile-hervorgehoben` nicht; die Regel in `index.css` erreicht sie nicht.
- Gesetzt wird `hervorgehoben` nur von `MeldungListe` (`?meldung=`) und `AuftragListe`
  (`?auftrag=`). Erinnerung und Nachforderung nutzen die Karte ohne Deeplink-Markierung.
- Alarm an der Karte: Meldung mit überfälliger Bestätigung (`istAlarmiert`), Auftrag mit
  `ist_ueberfaellig`.
- Gerechnete Abstände (WCAG, sRGB, Werte aus `theme/tokens.ts`):

  | Paar | Tag | Nacht |
  | --- | --- | --- |
  | `bedien` gegen `bedienFlaeche` | 7,23 | 5,66 |
  | `bedien` gegen `alarmFlaeche` | 6,98 | 5,94 |
  | `bedien` gegen `paneel` (Nachbarkarte) | 7,84 | 6,09 |
  | `bedien` gegen `flaeche` (Seitengrund) | 8,55 | 5,84 |
  | `bedienFlaeche` gegen `paneel` | 1,08 | 1,08 |

  Die Linie hält in jeder Lage ≥ 5,66 : 1, auch auf der Alarmfläche. Die Fläche allein trägt
  wie in der Tabelle nicht (1,08 : 1); die Linie ist der tragende Kanal.

## Goals / Non-Goals

**Goals:**

- Keine angesprungene Kommunikationskarte trägt einen Ring; sie trägt dieselbe Form wie
  Datensicht und Zeitachse.
- Eine alarmierte Karte bleibt auch angesprungen als Alarm erkennbar (Fläche und Kante).

**Non-Goals:**

- Keine Deeplink-Markierung für Erinnerung und Nachforderung (gibt es heute nicht).
- Kein Umbau der Karte auf die Klasse `.zeile-hervorgehoben`.
- Keine neue Farbrolle.

## Decisions

### E1: Dieselbe Form wie Datensicht und Zeitachse (Fläche plus Ober-/Unterlinie)

`KommKarte` übernimmt bei `hervorgehoben`: Grund `bedienFlaeche` und
`boxShadow: inset 0 2px 0 bedien, inset 0 -2px 0 bedien`. Eine Markierung, eine Form im ganzen
Produkt; der Messkern (`pruefeLinienform`) prüft genau diese Form.

Verworfene Alternativen:

- **Ring behalten**: Form des Fokusrings, Spec verbietet sie für Zeilen und Karten.
- **Nur Linien, keine Fläche** (für alle Karten): wäre eine zweite Form neben Datensicht und
  Zeitachse, ohne Gewinn; die Fläche ist am Tag ein zusätzlicher, wenn auch schwacher Kanal.
- **Linke Kante in `bedien`**: links liegt der Vertrag der Statuskante (Alarm vor Unbearbeitet),
  eine dritte Bedeutung auf derselben Kante bräche „eine Farbe“.

### E2: Gefahr gewinnt — Alarmfläche bleibt, nur die Linie kommt dazu

Bei `alarm` bleibt der Grund `alarmFlaeche`, die Markierung setzt nur den Schatten. Damit zählt
für den Grund die Reihenfolge `alarm` vor `hervorgehoben` vor `paneel`. Die linke Kante bleibt
in jedem Fall `kartenKante` (Alarm, Unbearbeitet, sonst Linie). Die Linie liegt als `inset`
innerhalb des Rahmens und berührt die 3-px-Kante nicht, sie überdeckt sie also nicht. Die
Bedienlinie oben und unten an einer Alarmkarte ist der Sprungkanal; die Alarmbedeutung tragen
Fläche, Kante, `data-alarm` und das Alarmetikett weiter.

Die Grundwahl wird als reine Funktion neben `kartenKante` geführt (`kartenGrund`), damit der
Vorrang ohne Rendern prüfbar ist, wie bei der Kante.

### E3: Inline statt Klasse

Die Karte setzt ihren Grund schon inline (wie `EtbZeitachse`); eine Klassenregel erreichte ihn
nur mit `!important`. Der Schatten steht deshalb ebenfalls inline, aus `rollen` (dieselben Werte
wie `--lfh-bedien`, `--lfh-bedien-flaeche`; der e2e-Abgleich mit den Rollen-Properties
belegt das im Browser).

## Risks / Trade-offs

- [Nachts trägt die Fläche fast nichts] → gewollt wie in der Tabelle; die Linie hält ≥ 5,66.
- [Ein `style`-Prop des Aufrufers mit eigenem `boxShadow` oder `background` überschriebe die
  Markierung] → heute setzt kein Aufrufer diese Eigenschaften (geprüft: `MeldungKarte`,
  `AuftragKarte`, Erinnerung, Nachforderung); Reihenfolge `...style` am Ende bleibt.
- [Der Seiten-Test prüft bisher nur `data-hervorgehoben`] → bleibt; die Form prüft der
  Komponententest (Schatten ohne Ring) und der e2e-Lauf (Form, Kontrast, Rollen).

## Migration Plan

Reine Frontend-Änderung mit dem nächsten Bundle. Rückweg: Revert des Commits.
