# Design

## Context

Den Austausch der Führungsakten beschreibt D3 der Change `v6hj7xl2-fuehrung-epoche`
(`openspec/changes/archive/2026-11-09-v6hj7xl2-fuehrung-epoche/design.md`). Für diese Change
zählt der heutige Stand:

- **Ein Zähler je Instanz.** `instanz_identitaet.fuehrung_stand` zählt bei jeder Änderung einer Akte
  eins hoch (`fuehrung::repo::next_stand`). Das gilt auch für eine fremde Akte, die diese Seite
  übernimmt (`insert_fremd`, `save`), und für das neue Stempeln einer Org (`renew_stand_der_org`).
  Der Stand ist **nur der Cursor des Austauschs**. Ob eine Akte neuer ist, entscheidet die Epoche
  (`austausch::entscheide`), nie der Stand.
- **Zwei Stände je Kopplung.** `fuehrung_gesendet_bis` ist das, was das Gegenüber quittiert hat.
  `fuehrung_empfangen_bis` ist das, was diese Seite übernommen hat, gemessen am Zähler des
  Gegenübers. Beide speichert `save_kopplung_staende` nur steigend (`MAX`).
- **Die meldende Seite** (`melden::melden_einmal`) sendet ab ihrem `gesendet_bis` und speichert die
  Quittung, die sie seit LLH-1672 auf das tatsächlich Gesendete kappt.
- **Die erreichte Seite** (`melden::handle_meldung`) sendet ab der Quittung in der Anfrage
  (`build_ausgang(ab = anfrage.fuehrung_bis)`). Ihr eigenes `gesendet_bis` liest sie dafür nicht.
- **Grenzen auf der Leitung:** Ein Stand gilt dem Empfänger nur in `1..=STAND_MAX` (2⁴⁰,
  `austausch::is_stand_plausibel`). Das prüft auch eine Gegenstelle älteren Stands.
- **Protokoll:** Das Schema der Meldung wächst nur additiv (`src/AGENTS.md`, Instanzkopplung).

Was beim Zurückspielen schiefgeht, steht in proposal.md unter „Why“.

## Goals / Non-Goals

**Goals:**

- Nach dem Zurückspielen einer Seite erreicht jede neue Änderung einer Akte das Gegenüber, in
  beiden Richtungen.
- Akten, die die zurückgespielte erreichte Seite verloren hat, schickt die meldende Seite erneut.
- Das gilt gleich, wie die Sicherung eingespielt wurde (`restore`, Datei von Hand zurückkopiert,
  Snapshot der VM).
- Keine Protokolländerung und keine Migration.

**Non-Goals:**

- Inhalte, die nur die zurückgespielte Seite vor dem Ausfall hatte und die das Gegenüber nie
  bekam. Was verloren ist, ist verloren.
- Widersprüche zwischen einer verlorenen und der zurückgespielten Fassung derselben Akte. Die regelt
  wie bisher die Epoche (`austausch::entscheide`).
- Die Zähler der Unterschriftsschlüssel und der Stammdaten. Sie prüft eine Folgeaufgabe.

## Decisions

### D1 Der Zähler folgt der Uhr

`next_stand` vergibt `MAX(fuehrung_stand + 1, Unix-Sekunden jetzt)` und schreibt den Wert zurück
wie bisher (ein `UPDATE … RETURNING`). Die Sekunden kommen aus Rust (`Utc::now().timestamp()`) als
Parameter. Eine innere Fassung nimmt sie als Argument, damit Unit-Tests eine Uhr setzen können.

Warum das hilft: Vor dem Ausfall vergebene Stände liegen höchstens wenig über der damaligen Zeit in
Sekunden. Nach dem Zurückspielen ist es später, also springt der erste neue Stand über alles, was das
Gegenüber quittiert haben kann. Das hängt nicht am Weg der Sicherung, und es braucht kein Feld auf
der Leitung.

- Laufen mehr als eine Änderung je Sekunde auf, zählt der Zähler mit +1 weiter und läuft der Uhr
  voraus. Das ist ein kurzer Vorlauf, kein Fehler.
- Die Werte (2026 um 1,8 · 10⁹) liegen weit unter `STAND_MAX` (2⁴⁰ ≈ 1,1 · 10¹²). Eine
  Gegenstelle älteren Stands nimmt sie an.
- Bestehende Zähler (kleine Werte) springen mit der ersten Änderung nach dem Update hoch. Das
  Gegenüber übernimmt die Akte und quittiert den großen Stand. Nichts geht verloren, weil der Sprung
  nur nach oben geht.

**Verworfen:**

- *Millisekunden:* Sie lägen über `STAND_MAX`, und eine Gegenstelle mit LLH-1672 lehnte jede Akte ab.
- *Sprung nur beim Serverstart:* Er braucht einen Haken im Start und ist nie besser als der Sprung
  je Vergabe.
- *Zähler-Epoche im Protokoll, die `restore` erneuert (Variante B):* Sie braucht eine Spalte, zwei
  Protokollfelder und einen Übergang für ältere Gegenstellen. Eine von Hand zurückkopierte Datei
  oder ein Snapshot erkennt sie nicht.
- *Nur den Zählerstand mitschicken (Variante C):* Hat die zurückgespielte Seite vor der ersten
  Meldung schon mehr Stände vergeben, als verloren gingen, liegt ihr Zähler wieder über der Quittung,
  und der Rückschritt bleibt unerkannt.

### D2 Die meldende Seite übernimmt eine kleinere Quittung

Ist in `melden_einmal` die Quittung des Gegenübers (`a.fuehrung_bis`) größer als 0 und kleiner als
das gespeicherte `fuehrung_gesendet_bis`, setzt die meldende Seite `gesendet_bis` auf diesen Wert.
Sie setzt ihn wirklich, statt ihn mit `MAX` zu mischen. Die nächste Meldung schickt dann alles
darüber erneut, auch die Akten, die der Hub mit der Sicherung verloren hat. Sonst gilt die
Kappung aus LLH-1672 unverändert, und gespeichert wird weiter steigend.

`fuehrung_empfangen_bis` speichert die erreichte Seite nur steigend. Ohne Zurückspielen kann ihre
Quittung also nie unter das sinken, was die meldende Seite als gesendet führt. Ein Rückschritt ist
deshalb ein sicheres Zeichen.

- **Warum nicht bei 0:** Ein Gegenüber ohne Schalter oder vor LLH-1491 antwortet immer mit 0. Die
  meldende Seite schickte ihm sonst mit jeder Meldung bis zu 50 Akten, die es verwirft. Ein Hub, der
  aus einer Sicherung von vor seiner ersten Übernahme zurückgespielt wird, bekommt die verlorenen
  Akten deshalb erst mit ihrer nächsten Änderung (Risiken).
- **Warum nur die meldende Seite:** Die erreichte Seite sendet ohnehin ab der Quittung der Anfrage.
  Ihr eigenes `gesendet_bis` braucht sie nur für D3.
- Nach dem Zurücksetzen meldet sich die meldende Seite im üblichen Abstand wieder, nicht sofort.
  Der erneute Versand ist einmalig und eilt nicht.

Ein neuer Schreibweg `fuehrung::repo::reset_gesendet_bis(conn, kopplung_id, bis)` setzt den Wert.
`save_kopplung_staende` bleibt bei `MAX`.

### D3 Netz: Eine Quittung über dem eigenen Zähler hebt ihn

Geht die Uhr der zurückgespielten Seite nach, greift D1 nicht. Dann quittiert das Gegenüber einen
Stand, den diese Seite nach ihrem Zähler nie vergeben hat. Daran erkennt sie den Rückschritt:

- **Erreichte Seite (`handle_meldung`)**, in der Transaktion **vor** `apply_eingang`. Ist
  `anfrage.fuehrung_bis` größer als `fuehrung_stand` und höchstens `STAND_HEBEN_MAX`, dann:
  1. `fuehrung_stand` auf diese Quittung setzen;
  2. die Akten der Orgs dieser Kopplung neu stempeln, deren Stand über dem gespeicherten
     `fuehrung_gesendet_bis` liegt, in Reihenfolge ihres Stands;
  3. einen Hinweis an die Kopplung schreiben, dass die Akten erneut gehen.

  `build_ausgang(ab = Quittung)` nimmt die neu gestempelten Akten dann gleich mit. Das gespeicherte
  `gesendet_bis` ist mit der Sicherung zurückgekehrt. Es nennt den letzten Stand, den das Gegenüber
  sicher hat. Alles darüber ist entweder schon beim Gegenüber (doppelt, schadet nicht) oder seit dem
  Zurückspielen neu vergeben (genau die Lücke). Vor `apply_eingang`, damit auch die Akten, die diese
  Meldung bringt, ihren Stand schon über der Quittung bekommen.
- **Meldende Seite (`melden_einmal`)**, in der Transaktion nach der Antwort. Ist `a.fuehrung_bis`
  größer als `fuehrung_stand` und höchstens `STAND_HEBEN_MAX`, hebt sie nur den Zähler. Sie sendet
  ab ihrem eigenen `gesendet_bis`, und das Gegenüber nimmt jeden plausiblen Stand an. Neu zu stempeln
  braucht sie also nichts. Der Hub hält danach kein überhöhtes `empfangen_bis` mehr gegenüber dem
  Zähler des ELW.

`STAND_HEBEN_MAX = STAND_MAX / 2` (2³⁹). Eine gekoppelte Seite kann den Zähler damit nicht bis an
die Grenze treiben, ab der jede weitere Akte abgelehnt würde. Bis dahin ist bei Sekunden Raum für
Jahrtausende. Eine größere Quittung hebt nichts, und das Verhalten bleibt das von heute.

Ein Schreibweg `fuehrung::repo::raise_stand(conn, auf)` hebt den Zähler (`MAX`).
`renew_stand_ueber(conn, org_ids, ab)` stempelt neu. `renew_stand_der_org` bleibt.

**Verworfen:** im Netz alle Akten neu zu stempeln. Das schickte jede Akte an jede Kopplung, auch an
die, deren Quittung stimmt. Eine weitere Kopplung mit eigener überhöhter Quittung erkennt den
Rückschritt bei ihrer eigenen Meldung selbst.

### D4 Übergang

Es gibt kein neues Feld und keine Migration. Gemischte Stände sind verträglich:

- Eine neue Seite vergibt große Stände. Eine alte Gegenstelle übernimmt und quittiert sie.
- Eine alte erreichte Seite liefert nur nach einem Zurückspielen eine kleinere Quittung. D2 an einer
  neuen meldenden Seite schickt dann erneut.
- Eine alte meldende Seite profitiert von D1 und D3 an einer neuen erreichten Seite, nicht von D2.

## Risks / Trade-offs

- **[Uhr der zurückgespielten Seite geht nach, und sie vergibt vor der ersten Meldung mehr Stände,
  als verloren gingen]** → D3 greift nicht mehr, weil der Zähler wieder über der Quittung liegt. Die
  Akten dazwischen erreichen das Gegenüber erst mit ihrer nächsten Änderung, wie heute. Die
  Kopplung zeigt ohnehin die Uhrabweichung (`uhr_abweichung_s`).
- **[Uhr springt weit nach vorn]** → Der Zähler bleibt dauerhaft hoch, aber unter `STAND_MAX`. Das
  stört nichts.
- **[Erreichte Seite aus einer Sicherung vor ihrer ersten Übernahme]** → Die Quittung ist 0, und D2
  greift nicht (s. D2). Die verlorenen Akten kommen mit ihrer nächsten Änderung.
- **[Einmaliger erneuter Versand nach D2 oder D3]** → Er läuft in Seiten zu höchstens 50 Akten je
  Nachricht (`AKTEN_MAX`). Eine Akte, die das Gegenüber schon hat, ändert dort nichts (Muster
  `renew_stand_der_org`).
- **[Tests, die feste kleine Stände erwarten]** → Sie werden auf relative Aussagen umgestellt
  (tasks.md 1.3).

## Migration Plan

Kein Schema. Ausrollen in beliebiger Reihenfolge, Rücknahme durch das alte Binary: Ein alter Stand
zählt vom hohen Wert mit +1 weiter, und das bleibt richtig.
