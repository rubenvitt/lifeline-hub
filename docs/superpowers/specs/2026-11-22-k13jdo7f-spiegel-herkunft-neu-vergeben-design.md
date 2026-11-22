# Spiegel: eine neu vergebene ID ist eine neue Zeile (LLH-1893)

Zunder: https://zunder.rubeen.dev/#/aufgabe/k13jdo7fgc22cwrszylmhiqs
Lösungsweg mit Ruben am 22.11.2026 abgestimmt: A (Herkunft beim Neuanlegen räumen) und C (Merker
„neu vergeben“ für `kennt: true`) in dieser Aufgabe.

## Problem

Viele gespiegelte Tabellen haben `id INTEGER PRIMARY KEY` ohne `AUTOINCREMENT`. Löscht eine
Instanz die Zeile mit der höchsten ID, vergibt SQLite diese ID an die nächste neue Zeile. Der
Spiegel kennt Zeilen nur über ihren Schlüssel: in `spiegel_herkunft` (fremder → lokaler
Schlüssel), im Log `einsatz_aenderung` und am Gegenüber in dessen `spiegel_herkunft`. Eine neue
Zeile unter einer alten ID erbt dort die Identität der gelöschten.

Beispiel aus der Aufgabe: Der Hub spiegelt Zeichen Z des ELW als `freies_zeichen.id = 40`, übernimmt
die Führung, löscht Z und zeichnet N, das wieder die ID 40 bekommt.

| Fall | Wo steht die veraltete Zuordnung | Folge heute |
|---|---|---|
| `gegen_hinaus` | am Hub: Herkunft `z → 40` | Der Hub schickt für N `gegen = z`. |
| `kennt: false` (Widerspruch, LLH-1854) | am Hub: Herkunft `z → 40` | `nicht_vom_fuehrer` hält N für eine Zeile des ELW, entfernt sie nicht, und die Lieferung ab 0 überschreibt N mit Z. |
| `kennt: true` (der ELW war selbst schon Spiegel des Hubs) | am ELW: Herkunft `40 → z` | `beantworte_bruch` meldet 40 als bekannt, und der ELW überschreibt N mit Z über `gegen`. |

Im dritten Fall hilft ein Räumen am Hub nicht, weil die Zuordnung am ELW liegt. Er tritt auch
ohne Herkunft am Hub auf: Legt der Hub als Führer Zeile 50 an, spiegelt der ELW sie, und löscht der
Hub sie und legt eine neue unter 50 an, so meldet der ELW nach einer Notübernahme 50 ebenfalls als
bekannt.

N steht danach nur noch in `einsatz_bruchstelle.daten` mit `entfernt = 0`, also weder in der Liste
„nicht übernommen“ noch im Hinweisband. Das ist ein stiller Verlust.

## Ansätze

- **A: Herkunft beim Neuanlegen räumen (gewählt).** Der Log-Trigger `<tabelle>_spiegellog_i`
  löscht beim Einfügen einer Zeile die Herkunft mit `(art, lokaler_schluessel)` dieser Zeile. Eine
  eingefügte Zeile ist nie die, auf die eine ältere Herkunft zeigt. Das behebt `gegen_hinaus` und
  `kennt: false`. Eine Löschung, die noch nicht beim Gegenüber ist, geht weiter mit ihrem `gegen`
  hinaus, weil die Herkunft erst fällt, wenn die ID wirklich neu vergeben wird.
- **B: Herkunft beim Löschen räumen (verworfen).** Eine noch nicht zugestellte Löschung verlöre ihr
  `gegen`. Hat das Gegenüber die Zeile nie zugeordnet bekommen, bliebe sie dort als Waise stehen.
- **C: Merker „neu vergeben“ (gewählt, zusätzlich zu A).** Er deckt `kennt: true`. Ohne neue
  Protokollversion kann der Spiegel dem Führer nicht sagen, welche Fassung eines Schlüssels er
  meint. Also merkt sich die Seite, die die ID neu vergeben hat, das selbst, und behandelt die Zeile
  nach dem Rückfall als unbekannt.
- **IDs nie wieder vergeben (verworfen).** `AUTOINCREMENT` für alle betroffenen Tabellen hieße,
  rund 80 Tabellen neu zu bauen. Bestehende Datenbanken behielten die alten IDs.

## Entwurf

### D1 Welche Tabellen

A und C gelten für gespiegelte Tabellen mit dem Ersatzschlüssel `id`
(`Schluessel::Spalte("id")`), ausgenommen `einsatz` selbst. Eine neue Einsatz-ID vergibt
`einsatz::repo::naechste_id` und nie eine alte (LFH-690). Tabellen mit natürlichem Schlüssel
(`einsatz_id`, `bild_id`, `uhs_id`) oder mehrspaltigem Schlüssel bleiben unverändert. Dort heißt
„dieselben Werte“ auch „dieselbe Zeile“, und eine neu angelegte Zeile ist zu Recht die alte.
Tabellen mit `AUTOINCREMENT` sind eingeschlossen. Für sie läuft die Prüfung ins Leere, aber die
Regel bleibt einfach und hält auch nach einem Umbau ohne `AUTOINCREMENT`.

### D2 Nur eigene Anlagen

Beide Schritte laufen nur außerhalb des Merkers `spiegel_uebernahme`, also bei einer Zeile, die
diese Instanz selbst anlegt. Unter dem Merker hält die Übernahme die Herkunft selbst nach
(`zeile_schreiben_innen` mit `INSERT OR REPLACE`, `loeschen`, `uebernimm_gegen`). An einem Spiegel
kommt außerhalb des Merkers keine Zeile an, weil die Schutz-Trigger das verhindern. Also betrifft
das nur Einsätze, die diese Instanz führt.

### D3 Der Trigger

`spiegel::art::trigger_sql` erzeugt für die Tabellen aus D1 diesen Log-Trigger. Schutz-, Update-
und Lösch-Trigger bleiben, wie sie sind.

```sql
CREATE TRIGGER t_spiegellog_i AFTER INSERT ON t WHEN <Einsatz besteht> BEGIN
    -- C: Stand im Log vor dieser Zeile = die ID war in diesem Einsatz schon vergeben.
    INSERT OR REPLACE INTO spiegel_neu_vergeben (einsatz_id, art, lokaler_schluessel, stand)
    SELECT <einsatz>, 't', <schluessel>, 0 WHERE <kein Merker> AND EXISTS (
        SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = <einsatz> AND art = 't'
        AND schluessel = <schluessel>);
    -- A: die Herkunft einer früheren Zeile unter derselben ID, in jedem Einsatz.
    DELETE FROM spiegel_herkunft WHERE <kein Merker> AND art = 't'
        AND lokaler_schluessel = <schluessel>;
    DELETE FROM einsatz_aenderung WHERE einsatz_id = <einsatz> AND art = 't' AND schluessel = <schluessel>;
    INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (<einsatz>, 't', <schluessel>);
    -- C: Der Merker trägt den Stand der neuen Zeile.
    UPDATE spiegel_neu_vergeben SET stand = (SELECT stand FROM einsatz_aenderung
        WHERE einsatz_id = <einsatz> AND art = 't' AND schluessel = <schluessel>)
    WHERE art = 't' AND lokaler_schluessel = <schluessel> AND stand = 0;
END;
```

A räumt die Herkunft über `(art, lokaler_schluessel)` ohne Einsatz, genau wie das
`UNIQUE (art, lokaler_schluessel)` der Tabelle. Vergibt SQLite die ID in einem anderen Einsatz
neu, zeigte die alte Herkunft sonst auf die Zeile dieses anderen Einsatzes.

Eine neue Migration baut `<tabelle>_spiegellog_i` für die Tabellen aus D1 neu (`DROP TRIGGER` und
`CREATE TRIGGER` aus dem Generator). Der Wächter `art::tests::trigger_passen_zur_beschreibung`
prüft das ohne Änderung.

### D4 Der Merker `spiegel_neu_vergeben`

```sql
CREATE TABLE spiegel_neu_vergeben (
    einsatz_id         INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    art                TEXT NOT NULL,
    lokaler_schluessel TEXT NOT NULL,
    stand              INTEGER NOT NULL,
    PRIMARY KEY (einsatz_id, art, lokaler_schluessel)
);
```

Er bedeutet: Dieser Schlüssel steht in diesem Einsatz seit `stand` für eine neue Zeile, und ein
Gegenüber, das bis dahin nicht abgeglichen hat, meint mit ihm vielleicht noch die alte. Eine
weitere Neuvergabe setzt `stand` auf die jüngste.

- **Aufräumen beim Wechsel zum Spiegel** (`fuehrung::werde_spiegel`): Merker mit
  `stand <= bekannt_bis` fallen. Diese Neuvergabe kennt der neue Führer schon.
- **Bruchstelle mit `kennt: true`** (`uebernimm_bruch_antwort`): Offene Zeilen der Bruchstelle bis
  `bis`, deren Schlüssel einen Merker hat, gelten als unbekannt, auch wenn der Führer sie kennt.
  Sie werden entfernt, und ihr Inhalt bleibt in der Bruchstelle (`entfernt = 1`). Bei
  `kennt: false` behandelt A sie schon als unbekannt (`nicht_vom_fuehrer`).
- **`gegen` am Spiegel** (`uebernimm_gegen`): Ein `gegen` auf einen Schlüssel mit Merker wird nicht
  übernommen. Die Zeile des Führers kommt als neue Zeile an. Steht sie schon unter genau diesem
  Schlüssel (`bisher == gegen`), bleibt es dabei.
- **Lebensende** (`lebensende::umwandeln` ohne Verwahrung): mit `spiegel_herkunft` geräumt.
- Eingeordnet als Verwaltung des Spiegels (`art::AUSGENOMMEN`) und in der Schwärzungsregistrierung
  (nur Schlüssel, keine Inhalte).

### D5 Bekannter Fehlalarm

Hat das Gegenüber die neue Zeile schon bekommen, aber noch nicht quittiert, wenn es die Führung
zurücknimmt, so steht sie danach zweimal: einmal als neue Zeile vom Führer und einmal in der Liste
„nicht übernommen“. Wer sie dort verwirft, hat alles wieder sauber. Ein Fehlalarm in der Liste
wiegt leichter als ein stiller Verlust. So mit Ruben am 22.11.2026 abgestimmt.

### D6 `sichere_bruchstelle`

Sie muss Löschen und Neuanlegen unter derselben ID nicht selbst unterscheiden. Das Log führt je
Schlüssel ohnehin nur den jüngsten Stand. Die Unterscheidung trägt der Merker aus D4, und
`uebernimm_bruch_antwort` wertet ihn aus.

### D7 Nicht in dieser Aufgabe

Wird eine ID in einem **anderen** Einsatz neu vergeben, behält das Gegenüber eine Zuordnung in den
alten Einsatz. Nach einem Rückfall mit `kennt: true` kann ein `gegen` dann auf den Schlüssel
zeigen, der jetzt im anderen Einsatz steht. `zeile_schreiben_innen` ändert über `id` ohne
Einsatzbezug und schöbe die Zeile hinüber. A räumt die Herkunft hier schon. Das `gegen` behandelt
LLH-2029 (Prüfung des Einsatzes in `uebernimm_gegen` und beim Ändern).

## Tests

Mit zwei Instanzen in `tests/instanz_fuehrung.rs`, jeweils für eine Tabelle aus D1
(`freies_zeichen`, über die Lagekarten-Route):

1. **Widerspruch (`kennt: false`, Akzeptanz):** Der ELW zeichnet Z, der Hub spiegelt Z und
   übernimmt per Notübernahme, löscht Z (die höchste ID) und zeichnet N unter derselben ID. Dann
   widerspricht der ELW, und es folgen Abgleiche. Danach steht N in der Bruchstelle mit
   `entfernt = 1`, und Z ist am Hub wieder da, einmal.
2. **`gegen_hinaus` (Akzeptanz):** Nach Löschen und Neuanlegen am Hub nennt `gegen_hinaus` für
   die neue Zeile keinen fremden Schlüssel, und die Herkunft der alten ist fort.
3. **`kennt: true`:** Der Hub legt als Führer eine Zeile an, der ELW spiegelt sie, der Hub löscht
   sie und legt eine neue unter derselben ID an, ohne dass der ELW das bekommt. Dann übernimmt der
   ELW. Die neue Zeile des Hubs steht als entfernt in der Bruchstelle, und die Zeile des ELW ist am
   Hub, einmal.
4. **Kein Merker ohne Neuvergabe:** Eine gewöhnliche neue Zeile setzt keinen Merker, und ein
   abgeglichener Wechsel räumt ihn (`stand <= bekannt_bis`).

Dazu ein Unit-Test für den Trigger in `art::tests`: Unter dem Merker `spiegel_uebernahme` bleibt
die Herkunft stehen, und es entsteht kein Merker.
