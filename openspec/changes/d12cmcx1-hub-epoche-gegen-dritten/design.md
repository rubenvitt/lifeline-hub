# Design

## Context

Motivation: proposal.md, „Why“. Grundlage ist die archivierte Change
`faq7l7m4-zwei-elw-unterlegene-seite` (design.md D2, D3, D7 und der letzte Punkt unter „Risks“).

Beobachtet am Stand `3d74eba3` in `apply_eingang` (`src/instanz/fuehrung/austausch.rs`): An ELW 2
gilt `a = (2,E2)`, Führer E2. Die Akte des Hubs ist `m = (3,Hub)`, Führer Hub (= Absender). Die
Vorprüfung für Dritte greift nicht: `dritter_fuehrt` ist falsch (der Hub führt), `dritte_epoche`
ist falsch (die Epoche vergab der Hub). Die Akte läuft in den Zweig `Greater` mit `nimmt_mir` und
`von_sender`, dann in `check_unterschrift`, und die Prüfung scheitert:

| Weg am Hub | Erklärung der Akte | Ergebnis von `check_unterschrift` an ELW 2 |
| --- | --- | --- |
| Notübernahme gegen ELW 1 (`notuebernahme_gegen_meldende`) | unterschrieben, `fuehrer_alt = E1`, `epoche_alt = (2,E1)` | „Erklärung passt nicht zur Übernahme“ |
| Widerruf der Zuordnung von ELW 1 (`repo::release_nach_widerruf`) | keine | „ohne Erklärung“ |

Danach folgt `verwerfen`: Benachrichtigung `fuehrung_ungueltig`, Admin-Spur `fuehrung_verworfen`,
Hinweis an der Kopplung, ELW 2 führt mit (4,E2), und der Hub nimmt das an.

Die zweite Zeile ist am Draht nicht vom Angriff zu unterscheiden, den
`uebernahme_ohne_gueltigen_beweis_wird_verworfen_mit_alarm` prüft: Ein Hub erklärt sich mit eigener
Epoche zum Führer, ohne Erklärung. Dieser Test bleibt laut Aufgabe grün.

Was schon passt: `dienst::bestaetigen`, `dienst::widersprechen`, `dienst::anzeige` und
`check_offene` lesen eine Erklärung nur, wenn sie gegen diese Instanz gerichtet ist
(`fuehrer_alt == ich`). Eine offen gehaltene Akte des Hubs mit Erklärung gegen ELW 1 bestätigt ELW 2
also ohne Unterschriftsprüfung und ohne Abgleich von `epoche_alt`, und ein Widerspruch vergibt die
nächste Epoche, die der Hub annimmt, weil er selbst führt. Das ist derselbe Weg wie D7 der
Vorgänger-Change.

## Goals / Non-Goals

**Goals:**

- Beide Wege aus der Tabelle führen an ELW 2 zu einer offenen Übernahme ohne Alarm.
- Eine Übernahme gegen die ELW ohne gültigen Beweis bleibt Verwerfen mit Alarm, auch ohne
  Erklärung.
- Kein neues Feld auf der Leitung, keine Migration, keine Codegen-Änderung.

**Non-Goals:**

- Die Erklärung gegen ELW 1 an ELW 2 auf ihre Unterschrift prüfen. Die Schlüssel, gegen die sie
  gälte, sind die der Org am Hub; ELW 2 muss sie nicht kennen, und die Einsatzleitung entscheidet
  ohnehin selbst (siehe Risks).
- Gemischte Versionen ohne Alarm: Ein Hub ohne diese Änderung schickt den Widerruf weiter ohne
  Erklärung.

## Decisions

### D1 Erklärung gegen eine andere Instanz heißt „Dritter beteiligt“

Im Zweig `Greater` der meldenden Seite gilt vor der Beweisprüfung:

```
richtung == MeldetSich && nimmt_mir && von_sender
  && erklaerung lesbar && erklaerung.fuehrer_alt != ich && erklaerung.epoche_alt != alt
  → entscheide(.., dritter = true) → offen halten
```

**Nachtrag beim Umsetzen: `epoche_alt != alt`.** Der Test
`unterschriebene_erklaerung_mit_abweichendem_feld_wird_verworfen` schickt eine unterschriebene
Erklärung, die den Stand der ELW (`epoche_alt = alt`) mit einem anderen bisherigen Führer nennt,
und erwartet Verwerfen. Ohne die Bedingung hielte die ELW sie offen. Die Erklärung widerspricht sich
aber selbst: Zu einer Epoche gehört genau ein Stand, und mit `alt` führt die ELW. Eine Erklärung
gegen einen Dritten nennt immer einen Stand, den die ELW nicht hat (in beiden Fällen der Aufgabe
`(2, E1)` gegen `(2, E2)`).

Die Prüfung steht nach den Sonderwegen für eine nie vergebene eigene Epoche, für Verwahrung und
für `!nimmt_mir`, also genau dort, wo heute `check_unterschrift` läuft. Sie geht über
`austausch::entscheide` mit dem vorhandenen Merker `dritter` (ADR-0028: die Annahmeregel
entscheidet). „Gegen mich“ steht damit an vier Stellen gleich (`anzeige`, `bestaetigen`,
`widersprechen`, `check_offene`); die neue Stelle nutzt dieselbe Ableitung über eine gemeinsame
Hilfsfunktion statt einer fünften Kopie.

Abgrenzung zum Angriff: Eine echte Übernahme gegen die ELW nennt die ELW als bisherigen Führer.
Eine Erklärung, die einen anderen nennt, kann die Führung der ELW nicht rechtfertigen; sie zeigt
nur, dass am Hub etwas ohne die ELW geschah. Die Einsatzleitung entscheidet dann wie bei D7.

**Abgestimmt mit Ruben am 12.11.2026 (V1).**

**Verworfen: Ohne Erklärung ebenfalls offen halten (V2).** Dann bliebe ein Hub, der sich ohne
Beweis zum Führer macht, ohne Alarm; der Test
`uebernahme_ohne_gueltigen_beweis_wird_verworfen_mit_alarm` würde rot.

**Verworfen: Nur den Fall mit Erklärung beheben, den Widerruf als Folgeaufgabe (V3).** Dann bliebe
das Akzeptanzkriterium für den Widerruf offen, obwohl der Weg dafür klein ist (D2).

**Verworfen: Am eigenen Stand ablesen, ob die ELW eine ungemeldete Notübernahme gegen den Hub
hält.** D7 der Vorgänger-Change hat schon festgestellt, dass an keiner Akte steht, ob der Hub die
eigene Epoche kannte. Ein Hub könnte die Lücke nach jeder Notübernahme der ELW nutzen.

### D2 Der Widerruf schreibt eine Erklärung ohne Beweis

`repo::release_nach_widerruf` setzt statt `erklaerung = None` eine `NotuebernahmeErklaerung`:

| Feld | Wert |
| --- | --- |
| `einsatz` | Kennung der Akte |
| `org` | Org-Schlüssel der widerrufenen Zuordnung, wie `list_orgs_der_kopplung` ihn bildet |
| `epoche_alt`, `fuehrer_alt` | Stand vor dem Zurückholen (das widerrufene Gegenüber) |
| `epoche_neu`, `fuehrer_neu` | die nächste eigene Epoche, diese Instanz |
| `grund` | „Kopplung widerrufen“ |
| `zeitpunkt` | jetzt |
| `unterzeichner` | leer: Es unterschreibt niemand |

Der Beweis bleibt `None`. Eine Erklärung ohne Beweis gibt es schon heute: die Notübernahme einer
ELW gegen den Hub (`notuebernahme_gegen_erreichte`). Den Org-Schlüssel kennt der Aufrufer
(`instanz::repo`, Widerruf der Zuordnung) aus der Zeile der Zuordnung; er gibt ihn mit.

Ein leerer Unterzeichner darf nirgends als „unterzeichnet von “ erscheinen. `unterzeichner_der`
(Verlauf an Instanzen, die die Akte nur übernehmen) gibt für einen leeren Namen `None`. Das
Hinweisband und das Paneel zeigen ihn ohnehin nur bei einer Erklärung gegen diese Instanz.

**Verworfen: eine eigene Art `widerruf`.** Dafür bräuchte es eine Migration für den CHECK der
Spalte `art` und eine Codegen-Änderung, und die Art allein bewiese so wenig wie die Erklärung.

**Verworfen: als Unterzeichner den Namen dieser Instanz.** Der Verlauf zeigte dann „unterzeichnet
von Hub Nord“, als hätte eine Person unterschrieben.

### D3 Was sich am Draht ändert und was nicht

Der Widerruf an der ELW (sie holt einen Einsatz vom Hub zurück) schreibt dieselbe Erklärung mit
dem Hub als bisherigem Führer. Sie erreicht den Hub über diese Kopplung nicht mehr, und nach einer
neuen Zuordnung nimmt der Hub die Akte der ELW wie bisher an (`wird_gemeldet` nimmt an).

Wird die widerrufene ELW 1 später neu zugeordnet, bekommt sie die Akte des Hubs mit einer
Erklärung gegen sich, ohne Unterschrift, und verwirft sie mit Alarm. Bisher geschah dasselbe
wegen der fehlenden Erklärung. Für ELW 1 ändert sich also nichts.

## Risks / Trade-offs

- [Ein böswilliger Hub schreibt eine Erklärung gegen einen erfundenen Dritten und bekommt so
  „offen halten“ statt Alarm] → Er erreicht damit nichts Neues: Einen Dritten als Führer zu nennen,
  führt schon heute zu „offen halten“ (Vorgänger-Change, Risks). Abgegeben wird nur nach
  Bestätigung durch die Einsatzleitung; ohne sie führt die ELW weiter.
- [Die Erklärung gegen ELW 1 trägt eine Unterschrift, die ELW 2 nicht prüft] → So gewollt: Sie
  begründet nichts gegen ELW 2. Band und Paneel zeigen ihre Angaben deshalb nicht (D3 der
  Vorgänger-Change).
- [Gemischte Versionen: alter Hub, neue ELW] → Der Widerruf kommt ohne Erklärung und schlägt
  weiter Alarm wie heute. Kein neuer Schaden, und mit dem Update des Hubs ist es vorbei.

## Migration Plan

Keine Migration, kein Wire-Feld, keine Codegen-Änderung. Akten, die vor dem Update per Widerruf
zurückgeholt wurden, behalten `erklaerung = NULL`; erst ein neuer Widerruf schreibt die Erklärung.
Rücknahme: den Commit zurücknehmen; ELW 2 schlägt dann wieder Alarm wie vorher.

ADR-0028 ist akzeptiert und unveränderlich. Eine neue ADR (nächste freie Nummer auf `alpha`)
ersetzt sie mit der erweiterten Ausnahme; ADR-0028 bekommt `status: ersetzt` und
`ersetzt_durch`.
