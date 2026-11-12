# Design

## Context

Motivation: proposal.md, „Why“. Grundlage sind die archivierte Change `v6hj7xl2-fuehrung-epoche`
(design.md D2, D7, D10 und die Nachträge aus dem Review) und LLH-1641 (der Spiegel folgt der
Akte).

Beobachtet am Stand `2cfab2c9` in `apply_eingang` (`src/instanz/fuehrung/austausch.rs`): Die meldende
Seite (ELW 2, sie führt selbst) bekommt vom Hub eine Akte, deren Führer weder sie noch der Hub ist.
Je nach Epoche läuft sie in einen von drei Zweigen, und keiner davon klärt den Zustand (ein vierter, verwandter Fall steht in D7):

| Fall | Zweig | Heute |
| --- | --- | --- |
| Hub-Akte größer, Epoche von ELW 1 (`(2,E1) > (2,E2)`) | `Greater`, `!von_sender && nimmt_mir` | `continue`, nichts geschieht |
| Hub-Akte größer, Epoche vom Hub (Übergabe oder Anfrage an ELW 1) | `Greater`, `von_sender`, Beweisprüfung | Verwerfen mit Alarm „ungültige Übernahme“, Epoche `(3,E2)`, die der Hub wieder ablehnt |
| Hub-Akte kleiner (`(2,E1) < (2,E2)`) | `Less` | eigene Akte neu speichern, der Hub lehnt sie wieder ab |

Am Hub greift dabei jedes Mal der Diebstahlschutz (Zeilen 615–624): Liegt die Führung weder beim
Hub noch beim Sender, lehnt er ab und setzt nur einen Hinweis an der Kopplung.

Eine Beobachtung, die den Schnitt bestimmt: **Zwischen genau zwei Instanzen entsteht kein Gleichstand
zweier Notübernahmen.** Eine Notübernahme erklärt nur, wer nicht führt (`fordere_nicht_fuehrend`),
und von zwei Instanzen führt immer eine. Zwei Notübernahmen mit gleichem Zähler brauchen zwei
Nichtführer, also mindestens drei Instanzen, und gekoppelt sind sie nur über die erreichte Seite.
Das Spec-Szenario „Gleichstand zweier Notübernahmen“ beschreibt also genau diesen Fall, und der
bisherige Test dazu konnte ihn nur mit einem rohen `UPDATE` am Hub vortäuschen.

## Goals / Non-Goals

**Goals:**

- Nach dem nächsten Meldetakt weiß die unterlegene ELW, dass eine andere führt, und zeigt es,
  bis ihre Einsatzleitung bestätigt (Spec, neue Anforderung).
- Der Fall läuft ohne neues Feld auf der Leitung, ohne Migration und ohne neue
  Benachrichtigungsart.
- Tests mit drei Instanzen und echten Erklärungen, deterministisch über die Zähler.

**Non-Goals:**

- Die Daten, die die unterlegene ELW seit ihrer Übernahme erfasst hat, zur führenden ELW
  bringen. Beim Bestätigen sichert der vorhandene Weg sie als Bruchstelle (`werde_spiegel`). Ist die
  ELW mit der führenden Instanz nicht gekoppelt, endet ihr Spiegel mit Hinweis
  (`kopplung_org_des_fuehrers` ist `None`), wie heute schon bei einer regulären Übergabe an eine
  dritte Instanz.
- Den Diebstahlschutz am Hub ändern.
- Einen Konflikt zwischen genau zwei Instanzen behandeln: Den gibt es nicht (Context).

## Decisions

### D1 Der Hub entscheidet, wer zuerst kommt

Die erreichte Seite behält die zuerst angenommene Führung einer meldenden Seite. Das tut der Code
schon (Diebstahlschutz). Neu ist, dass es auch in der Spec steht: als Ausnahme in „Die größere
Epoche gilt“ und als neuer Inhalt des Szenarios „Gleichstand zweier Notübernahmen“.

**Abgestimmt mit Ruben am 12.11.2026.**

**Verworfen: Die größere Epoche gilt auch hier.** Der Hub erkennt zwei Übernahmen vom selben
Ausgangsstand (`epoche_alt` der Erklärung) und wechselt zur größeren. Dann verliert ELW 1 die
Führung womöglich erst, nachdem sie eine Weile geschrieben hat, nur wegen des Zufalls in der
Kennung. Außerdem kann jede ELW einen passenden Ausgangsstand behaupten, und der Diebstahlschutz
wäre damit wieder offen.

**Verworfen: Den Fall sperren.** Eine Notübernahme gegen den Hub ginge nur bei genau einer
gekoppelten ELW der Org. Ohne Verbindung kennt die ELW den Stand des Hubs ohnehin nicht, und bei
mehreren ELW gäbe es keine Notübernahme mehr.

### D2 Erkennen an der meldenden Seite: „Ich führe, der Hub nennt einen Dritten“

In `apply_eingang` gilt an der meldenden Seite vor der Fallunterscheidung nach der Epoche:

```
richtung == MeldetSich && ich_fuehre && m.fuehrer != ich && m.fuehrer != sender
  → Konflikt: die Akte des Hubs als offene Übernahme halten
```

Für alle drei Zweige aus der Tabelle (Context) gilt dieselbe Regel. Sie ist das genaue Gegenstück
zum Diebstahlschutz: Der Hub lehnt die Epoche der ELW genau dann ab, wenn die Führung
weder bei ihm selbst noch bei der meldenden Seite liegt. Solange er einen Dritten nennt, nimmt er
also nichts an, was die ELW schickt, gleich wie groß ihre Epoche ist. Ob die eigene Epoche schon
angenommen war, muss die ELW dafür nicht wissen. Der Hub hält je Kennung genau eine Akte und hätte
sonst die eigene zurückgemeldet.

Die Regel steht vor der Ausnahme für die Verwahrung (`m.fuehrer == sender`) und vor der
Beweisprüfung. Die Akte eines Dritten ist kein Angriff, also gibt es weder Alarm noch Verwerfen.

**Verworfen: ein eigenes Signal des Hubs („deine Epoche abgelehnt“).** Dafür bräuchte es ein
neues Feld auf der Leitung und einen gespeicherten Ablehnungsstand je Kopplung. Die Akte, die der
Hub ohnehin schickt, trägt die Information schon.

**Verworfen: nur die Übernahmen mit Art `notuebernahme` prüfen.** Derselbe Konflikt entsteht nach
einem Widerspruch oder einem Verwerfen, also mit derselben Struktur, aber anderer Art.

### D3 Offen halten über den vorhandenen Ablauf, gekennzeichnet als Konflikt

Die Akte des Hubs landet in `offen` und `offen_bruch_at` wie bei einer gültigen Übernahme gegen
die ELW (Zweig `OffenHalten`): mit `Folge::Offen` (Benachrichtigung `FuehrungUebernommen` an die
Einsatzleitung) und `Folge::Kopf`. Eine eigene Spalte gibt es nicht. Konflikt heißt: Der Führer der
gehaltenen Akte ist keiner der Hubs, bei denen sich diese Instanz für die Org meldet
(`repo::list_hubs`; im Austausch ist das der Absender). Eine zusätzliche Kopplung, über die sich die
führende ELW bei dieser Instanz meldet, ändert daran nichts. Die Ableitung steht an genau einer
Stelle (`ist_konflikt(&AkteMeldung, hubs)`). Der Weg läuft über `austausch::entscheide`, das dafür
den Merker `dritter` bekommt: An der meldenden Seite heißt `dritter` immer offen halten, ohne
Beweisprüfung und ohne Alarm. Die Tabelle D7 der Vorgänger-Change bekommt damit eine Zeile:

| Eingehende Akte nimmt mir die Führung | `wird_gemeldet` (Hub) | `meldet_sich` (ELW) |
| --- | --- | --- |
| Ein Dritter führt, oder er hat die Epoche vergeben, mit der das Gegenüber selbst führt | — | offen halten, ohne Alarm (D3, D7) |

**Gleicher Inhalt** heißt gleiche Akte ohne `stand` und ohne die Merker `offen` und `anfrage`. Ändert
sich nur der Stand des Hubs, schreibt die ELW nichts und meldet nichts. Sonst schaukelten sich beide
Stände je Meldetakt hoch, wenn die Epoche des Hubs größer ist (Zweig `Less` am Hub): Der Hub
schickte seine Akte mit neuem Stand zurück, die ELW hielte sie erneut offen, und die
Einsatzleitung bekäme jedes Mal einen Hinweis (Befund aus dem Review). Gleich heißt dieselbe
Epoche, derselbe Führer und dieselbe Erklärung (`AkteMeldung::is_gleicher_wechsel`). Die
Bruchstelle gilt der Übernahme: Bei derselben Epoche bleibt sie, erst eine größere bekommt ihre
eigene. Beides kam beim Merge von `alpha` aus LLH-1671 dazu, das denselben Fehler am Zweig
`OffenHalten` behob; `halte_offen` ist seither der eine Weg für beide.

**Angaben im Band:** Grund, Unterzeichner und Zeitpunkt zeigt `anzeige` nur aus einer Erklärung
gegen diese Instanz (`fuehrer_alt == ich`). Im Konflikt trägt die Akte meist die Erklärung der
anderen ELW gegen den Hub, und deren Angaben sähen sonst wie die eigenen aus.

Die ELW schreibt weiter, bis ihre Einsatzleitung bestätigt. `fordere_fuehrend` sperrt Übergabe und
Code-Abgabe, solange etwas offen ist; das gilt hier genauso.

`FuehrungOffen` bekommt `konflikt: bool`, erzeugt per Codegen. Das Hinweisband zeigt dann den Titel
„Deine Notübernahme hat am Hub nicht gegriffen, die Führung liegt bei <Name>“ und als einzige
Aktion „Übernahme bestätigen“. War die eigene Führung keine Notübernahme (Übergabe, Anfrage,
Widerspruch, Verwerfen), heißt der Titel „Die Führung liegt am Hub bei <Name>, nicht hier“. Das
Paneel „Führung“ zeigt dieselbe Entscheidung, ohne die Felder der Erklärung.

**Verworfen: eine neue Benachrichtigungsart.** Dafür bräuchte es eine Migration für den CHECK.
„Führung übernommen“ stimmt inhaltlich, die Einzelheiten zeigt das Band.

### D4 Bestätigen übernimmt die Akte des Hubs, auch mit kleinerer Epoche

`bestaetigen` verlangt heute `m.epoche > a.epoche()` und `epoche_alt == a.epoche()`. Für den
Konflikt gelten andere Bedingungen:

- Diese Instanz führt noch (sonst 409 „Die Führung hat sich inzwischen geändert.“).
- Der Führer aus der gehaltenen Akte muss nicht gekoppelt sein. Es ist ja ein Dritter, und die
  heutige Prüfung „übernehmende Instanz noch gekoppelt“ entfällt für den Konflikt.

Dann übernimmt die ELW Epoche, Führer und Art der gehaltenen Akte, setzt `bruch_at` aus
`offen_bruch_at`, und `repo::save` richtet den Spiegel aus. Danach steht die Epoche lokal wieder
gleich wie am Hub (`Equal`), und der Takt ist ruhig. Ist die Epoche des Hubs kleiner als die eigene,
geht die Epoche lokal zurück. Das ist hier richtig, denn die größere Epoche gilt an keiner Stelle:
Der Hub hat sie nie angenommen. Der Verlauf bekommt einen Eintrag „bestätigt“ mit dem Grund „Notübernahme
hat am Hub nicht gegriffen, Führung bei <Name>“ (ohne eigene Notübernahme: „Führung hat am Hub nicht
gegriffen, sie liegt bei <Name>“) und der Bruchstelle, ohne Unterzeichner. Die Admin-Spur schreibt
denselben Text, nicht „Notübernahme bestätigt“ mit dem Grund der anderen ELW.

### D5 Widersprechen im Konflikt ist 422

`widersprechen` antwortet bei einem Konflikt mit 422 „Die Führung liegt bei „<Name>“; ein
Widerspruch würde am Hub nicht greifen.“ (Zustand, `src/AGENTS.md`, Statuscode-Konvention). Die
Oberfläche zeigt die Schaltfläche gar nicht erst.

### D6 Der Konflikt erlischt, sobald der Hub keinen Dritten mehr nennt

Einen eigenen Zweig dafür gibt es nicht. Nennt der Hub keinen Dritten mehr, gibt es nur drei
Wege, und jeder räumt den Konflikt schon ab:

- Der Hub führt mit der Epoche des Dritten (der gab an ihn zurück): D7 ersetzt die gehaltene Akte
  mit ihrer eigenen Bruchstelle, denn die Epoche ist größer.
- Der Hub führt mit einer eigenen Epoche (Widerruf oder Notübernahme gegen den Dritten): Der Zweig
  `Greater` verwirft oder hält offen, und beides ersetzt `offen` (zum Fehlalarm dabei: LLH-1707).
- Der Hub nennt die ELW selbst: Der Zweig `!nimmt_mir` räumt `offen` ab.

Ein eigener Zweig davor leerte `offen` erst und hielt es dann neu (Befund aus dem Nach-Review). Eine kleinere
Epoche mit dem Hub als Führer kann nach einem Konflikt nicht mehr kommen, denn der Hub zählt nur
weiter.

Der Widerruf einer Kopplung räumt eine offene Übernahme ab, wenn die widerrufene Kopplung ein Hub
war und kein verbleibender Hub der genannte Führer ist (`repo::release_nach_widerruf`). Ohne den
Hub kommt keine Akte mehr, die sie ersetzen ließe, und die ELW stünde sonst dauerhaft mit Band und
gesperrter Übergabe da. Ein Widerruf einer anderen Kopplung der Org räumt nichts ab.

### D7 Führt der Hub mit der Epoche eines Dritten, entscheidet ein Mensch

Nachtrag beim Umsetzen. Eine ELW führt, und der Hub führt laut seiner Akte selbst, mit einer
größeren Epoche, die eine dritte Instanz vergeben hat. Das passiert etwa, wenn eine andere ELW die
Führung regulär an den Hub zurückgegeben hat, während diese ELW ohne Verbindung ihre Notübernahme
gegen den Hub mit kleinerem Zähler erklärte. Vorher übersprang die ELW die Akte, und beide führten.

Die ELW hält die Akte des Hubs als gewöhnliche offene Übernahme (kein Konflikt, D3): Band „Führung
übernommen von <Hub>“, ein Hinweis an die Einsatzleitung, kein Alarm, sie schreibt weiter.
„Übernahme bestätigen“ macht sie zum Spiegel. „Widersprechen“ vergibt die nächste Epoche (D10 der
Vorgänger-Change), und der Hub nimmt sie an, weil er selbst führt.

```
richtung == MeldetSich && ich_fuehre && m.epoche > alt && m.fuehrer == sender
  && m.epoche.instanz != sender && m.epoche.instanz != ich
  → entscheide(.., dritter = true) → offen halten
```

**Abgestimmt mit Ruben am 12.11.2026, zweimal.** Zuerst stand hier „still nachziehen“: die nächste
Epoche ohne Rückfrage. Der Review vor dem PR zeigte, dass das eine unterschriebene Notübernahme des
Hubs gegen die ELW ohne Menschen zurückdrehen kann. Der Hub holt der ELW die Führung per
Unterschrift, gibt sie an eine andere ELW und bekommt sie zurück; meldet sich die erste ELW danach,
sieht ihre Akte genau so aus wie im gemeinten Fall. Ob der Hub die eigene Führung kannte, steht an
keiner Akte. Deshalb entscheidet jetzt die Einsatzleitung.

**Verworfen: still nachziehen** (siehe oben). **Verworfen: still nur bei eigener Notübernahme.** Das
bliebe offen für den Fall, dass der Hub die eigene Notübernahme der ELW erst angenommen und dann
zurückgeholt hat. **Verworfen: eine Spalte, ob der Hub die eigene Epoche bestätigt hat.** Das ist
genauer, braucht aber eine Migration für einen seltenen Fall. **Verworfen: Verwerfen mit Alarm wie
in D7 der Vorgänger-Change.** Es gibt keinen Beweis gegen die ELW, also auch nichts Ungültiges.

## Risks / Trade-offs

- [Eine böswillige erreichte Seite kann der ELW einen Dritten als Führer vorgaukeln] → Abgegeben
  wird nur nach Bestätigung durch die Einsatzleitung (D3, D4), wie bei jeder Übernahme gegen die
  ELW. Ohne Bestätigung führt sie weiter. Gegenüber heute wird nichts schwächer: Schon heute nimmt
  die meldende Seite eine Übergabe an eine dritte Instanz zur Anzeige an.
- [Zwischen der Übernahme der ELW und ihrer Bestätigung schreiben beide ELW] → So abgestimmt
  („weiterschreiben, nur Bestätigen“), sichtbar durch Band und Hinweis. Die Spec erlaubt das
  ausdrücklich („oder die unterlegene Seite zeigt eine offene Übernahme“).
- [Die Epoche geht beim Bestätigen lokal zurück (D4)] → Die Epoche wird nur über den Vergleich mit
  eingehenden Akten und über `Epoche::naechste` gelesen. Beide sehen danach den Stand des Hubs, und
  die nächste eigene Epoche zählt von dort weiter. Ein Test belegt den ruhigen Takt danach.
- [Die Daten der ELW aus der Zeit, in der sie führte, kommen nicht bei der führenden ELW an] →
  Non-Goal. Sie bleiben als Bruchstelle gesichert. Ist die führende ELW hier nicht gekoppelt, endet
  der Spiegel nach dem Bestätigen mit Hinweis und bekommt keine Änderungen mehr; das Anwenderkapitel
  sagt das. Fällt das im Betrieb auf, wird es eine eigene Aufgabe.
- [Eine Epoche, die der Hub selbst vergab, nimmt der ELW die Führung ohne Beweis gegen sie, etwa
  der Widerruf einer anderen ELW am Hub oder seine Notübernahme gegen die andere ELW] → Das läuft
  wie vor dieser Change auf Verwerfen mit Alarm, und danach führt die ELW. Die Erklärung richtet
  sich dann gegen einen Dritten, und die ELW könnte das erkennen. Das ist eine eigene Aufgabe, denn
  der Weg ändert sich mit dieser Change nicht.

## Migration Plan

Keine Migration, kein Wire-Feld. `FuehrungOffen.konflikt` ist ein Feld der Antwort (Codegen). Ältere
Clients kennen es nicht und zeigen das alte Band samt „Widersprechen“; der Server antwortet dann mit
422. Rücknahme: den Commit zurücknehmen. Offene Konflikte bleiben dann als gewöhnliche offene
Übernahme stehen, und „Bestätigen“ scheitert an den alten Prüfungen mit 409.
