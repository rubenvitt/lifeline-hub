# Design

## Context

Den Austausch der Führungsakten hat LLH-1708 gegen das Zurückspielen gesichert
(`openspec/changes/archive/2026-11-12-xi5ugyt8-fuehrung-stand-nach-restore/design.md`, D1 bis D5).
Diese Change trägt das Muster auf die beiden anderen Ströme der Meldung. Beide fließen nur in eine
Richtung: von der erreichten Seite (Hub) zur meldenden (ELW). Für sie gilt heute:

- **Unterschriftsschlüssel.** `auth::unterschrift::repo::next_stand` vergibt `MAX(stand) + 1` über
  die lokalen Schlüssel einer Org. Das gilt beim Anlegen, beim Gegenzeichnen und beim Widerruf. Die
  meldende Seite merkt sich je Org-Zuordnung `unterschrift_stand`, das Höchste, was sie übernommen
  hat, und meldet ihn. `handle_meldung` liefert über `unterschrift::nachlieferung(seit)` alle
  gültigen und widerrufenen lokalen Schlüssel mit `stand > seit`, höchstens 64 je Antwort. Am ELW
  ordnet `accept_lieferungen` eine Lieferung über `(kopplung_org_id, fremde_id)` zu. Unter einer
  bekannten id ändert ein gültiger Schlüssel nichts, ein widerrufener setzt den Zustand.
- **ids der Schlüssel.** `unterschrift_schluessel` hat kein AUTOINCREMENT (Migration 0308). Nach dem
  Zurückspielen vergibt SQLite die id eines verlorenen Schlüssels neu, wenn er die höchste war.
- **Stammdaten.** Die Trigger aus 0306 und 0312 schreiben je `(org_id, art, schluessel)` eine Zeile
  in `stammdaten_aenderung` (Löschen und Einfügen). `stand` ist `INTEGER PRIMARY KEY AUTOINCREMENT`
  und global über alle Orgs. Der Zähler steht in `sqlite_sequence` und damit in der Sicherung. Die
  meldende Seite meldet `stammdaten_stand` je Org (`-1` = keine Quelle). `liefern::nachlieferung`
  liefert Log-Zeilen der Org mit `stand > seit` bis zum Budget, und die meldende Seite speichert
  `stammdaten_bis` nur steigend (`repo::save_stammdaten_stand`).
- **Zurückgespielte meldende Seite.** Die erreichte Seite liefert in beiden Strömen ohne eigenen
  Sendestand ab dem gemeldeten Stand. Fällt der Stand der meldenden Seite mit ihrer Sicherung zurück,
  liefert die erreichte Seite schon heute erneut. Die Tests sichern das nur ab.
- **Zurückspielen** geht über `lifeline-hub restore` (offline, verlangt den Neustart) oder durch
  Zurückkopieren der Datei bei gestopptem Server. Ein Snapshot der VM mit laufendem Prozess ist der
  einzige Weg ohne Neustart.

## Goals / Non-Goals

**Goals:**

- Neue, gegengezeichnete und widerrufene Schlüssel und jede Stammdaten-Änderung erreichen nach dem
  Zurückspielen der erreichten Seite die meldende Seite, ohne Eingriff.
- Keine Migration, kein Protokollfeld. Eine Gegenstelle älteren Stands bleibt verträglich.

**Non-Goals:**

- Schlüssel und Zeilen, die die erreichte Seite mit der Sicherung verlor und die die meldende Seite
  schon hat: Sie bleiben dort stehen (Folgeaufgabe LLH-1871).
- Die Führungsakten (LLH-1708).

## Decisions

### D1 Der Zähler der Schlüssel folgt der Uhr

`next_stand` vergibt `MAX(MAX(stand) + 1, Unix-Sekunden jetzt)`. Die Sekunden kommen aus Rust
(`Utc::now().timestamp()`). Eine innere Fassung nimmt sie als Argument, damit ein Unit-Test die Uhr
setzen kann. Das wirkt bei allen drei Vergaben (Anlegen, Gegenzeichnen, Widerruf).

Warum: Stände vor dem Ausfall liegen höchstens wenig über der damaligen Zeit in Sekunden. Nach dem
Zurückspielen ist es später, also liegt der erste neue Stand über allem, was die meldende Seite
übernommen haben kann. Das hängt nicht am Weg der Sicherung, auch nicht an einem Neustart.

- Mehrere Vergaben je Sekunde zählen mit +1 weiter und laufen der Uhr kurz voraus.
- Die Werte (um 1,8 · 10⁹) speichert die Gegenseite als `INTEGER`. `accept_lieferungen` rechnet
  mit ihnen nur `max` und `min - 1`. Eine Gegenstelle älteren Stands nimmt sie an.

**Verworfen:** *Sprung nur beim Start* (wie D3 für die Stammdaten). Er wäre nie besser als der
Sprung je Vergabe, und der kostet hier nur einen Parameter in Rust.

### D2 Netz der Schlüssel: ein gemeldeter Stand über dem eigenen Höchsten

Geht die Uhr der zurückgespielten Seite nach, greift D1 nicht. Dann meldet die meldende Seite für
eine Org einen `unterschrift_stand`, der über dem höchsten Stand aller lokalen Schlüssel der Org
liegt. Den hat die erreichte Seite nie vergeben, also wurde sie zurückgespielt. Gemeldet werden kann
nur, was geliefert wurde, und das sind lokale Schlüssel. Ohne Zurückspielen gilt daher stets
gemeldet ≤ höchster.

`handle_meldung` prüft das je aktiver Org vor `unterschrift::nachlieferung`, in derselben
Transaktion. Liegt der gemeldete Stand darüber und höchstens bei `STAND_RAISE_MAX` (2³⁹, wie
LLH-1708), ruft sie `unterschrift::renew_stand_ueber(conn, org_id, gemeldet)` auf. Das stempelt
**alle** gültigen und widerrufenen lokalen Schlüssel der Org in der Reihenfolge ihres Stands neu auf
`gemeldet + 1, gemeldet + 2, …`. Die Nachlieferung derselben Meldung nimmt sie gleich mit, wie
bisher in Seiten zu 64. An der Kopplung steht dann der Hinweis „Der Stand der Unterschriftsschlüssel
lag unter dem von <Gegenüber> gemeldeten. Die Schlüssel von <Org> gehen erneut an <Gegenüber>.“

- **Alle statt einer Auswahl:** Welche Schlüssel seit dem Zurückspielen neu oder widerrufen sind,
  weiß die Seite nicht. Es sind wenige. Einen schon bekannten gültigen Schlüssel übergeht die
  Gegenseite, ein bekannter widerrufener setzt nur den Zustand erneut.
- **Wartende Schlüssel** (`wartet_auf_gegenzeichnung`) bleiben unberührt. Sie gehen nicht hinaus
  und bekommen beim Gegenzeichnen einen Stand nach D1, der über dem neu gestempelten liegt.
- **Mehrere Kopplungen:** Das Stempeln hebt den Höchsten der Org für alle. Eine zweite meldende
  Seite mit höherem Stand löst es erneut aus. Eine mit kleinerem Stand bekommt die neu gestempelten
  Schlüssel ohnehin.
- **Grenze:** Ein Stand über 2³⁹ hebt nichts. Eine fehlerhafte Gegenstelle kann den Zähler so nicht
  in die Nähe des `i64`-Endes treiben, ab dem `gemeldet + n` überliefe.

**Verworfen:** *Nur die Kopplung bedienen, die den Rückschritt zeigt.* Der Stand gilt je Org, nicht
je Kopplung (vgl. LLH-1708, D3, Review B2).

### D3 Der Zähler des Stammdaten-Logs springt beim Start auf die Uhr

`run_server` ruft nach `db::migrate` `stammdaten::raise_log_stand(pool, Unix-Sekunden jetzt)` auf.
Das setzt `sqlite_sequence.seq` für `stammdaten_aenderung` auf mindestens diesen Wert. Fehlt die
Zeile, legt es sie an. Jede Änderung danach bekommt über AUTOINCREMENT einen Stand darüber.

Warum: Zurückspielen per `restore` und per Dateikopie verlangt einen Neustart, und der Neustart liegt
zeitlich nach jeder Änderung, die vor dem Ausfall geliefert wurde.

**Verworfen:**

- *Ein Trigger, der jeden Log-Eintrag auf die Uhr hebt:* Er wirkt auch ohne Neustart. Er braucht aber
  eine Migration, und er schriebe in ein AUTOINCREMENT, dessen `sqlite_sequence` SQLite am Ende des
  Statements selbst überschreibt. Ändert sich dieselbe Zeile in derselben Sekunde erneut, könnte ein
  Stand doppelt vergeben werden. Den Fall ohne Neustart (VM-Snapshot) fängt D4.
- *Die Trigger aller Tabellen auf einen uhrbasierten Stand umschreiben:* alle Log-Trigger der
  verteilten Tabellen in einer Migration neu, für denselben Gewinn.

### D4 Netz der Stammdaten: ein gemeldeter Stand über dem Höchsten der Org

Dieselbe Erkennung wie D2. Liegt der gemeldete `stammdaten_stand` einer Org über dem höchsten
`stand` ihrer Log-Zeilen und höchstens bei 2³⁹, wurde die erreichte Seite zurückgespielt. Eine Zeile
einer Org wandert bei jeder Änderung nur nach oben (Löschen und Einfügen), und `nachlieferung` meldet
als `bis` nur Stände dieser Org. Ohne Zurückspielen gilt daher stets gemeldet ≤ höchster.

`handle_meldung` prüft das je Org vor `liefern::nachlieferung`. Dann ruft sie
`stammdaten::renew_log_der_org(conn, org_id, gemeldet)` auf: `sqlite_sequence` auf mindestens den
gemeldeten Stand heben, die Log-Zeilen der Org in Reihenfolge lesen, löschen und in derselben
Reihenfolge neu einfügen. Jede bekommt so einen Stand über dem gemeldeten. Die Nachlieferung liefert
dann die ganze Org erneut, in Seiten nach dem bestehenden Budget. Der Hinweis an der Kopplung lautet
wie in D2, mit „Stammdaten“ statt „Schlüssel“.

- **Ganz statt einer Auswahl:** wie D2. Unveränderte Zeilen übernimmt die meldende Seite ohne Wirkung.
- **Nur Orgs dieser Kopplung,** nur mit Stand `≥ 0` und nur über eine Kopplung, die Stammdaten
  trägt. Eine Direktkopplung (LLH-1497) liefert nie Stammdaten.

### D5 Ein anderer Schlüssel unter bekannter id ersetzt den alten

`accept_lieferungen` liest zur bekannten `(kopplung_org_id, fremde_id)` zusätzlich `credential_id`
und `schluessel`. Weicht einer davon von der Lieferung ab, hat das Gegenüber die id neu vergeben, und
den alten Schlüssel kennt es nicht mehr. Dann gilt:

1. Der alte wird `widerrufen` (`widerrufen_at` gesetzt), außer er ist `abgelehnt`, dann bleibt er
   es. Seine `fremde_id` wird auf `-id` gesetzt, die negative eigene id. So ist der eindeutige Index
   `(kopplung_org_id, fremde_id)` frei, und der CHECK `fremde_id IS NOT NULL` bleibt erfüllt. Ein
   Gegenüber vergibt nie negative ids.
2. Die Lieferung läuft weiter wie ohne bekannte id. Ein gültiger Schlüssel braucht die Gegenzeichnung
   eines dort bekannten Schlüssels. Der alte zählt dabei nicht mehr, weil er schon widerrufen ist.
   Danach wartet er auf Bestätigung. Ein widerrufener unbekannter ändert nichts.

Warum widerrufen: Den alten Schlüssel führt die Org am Gegenüber nicht mehr, und dort kann ihn
niemand mehr widerrufen. Ein Gegenüber kann jeden seiner Schlüssel ohnehin per Widerruf zurückziehen,
also gewinnt es dadurch keine neue Macht.

**Verworfen:**

- *Den neuen ablehnen und einen Hinweis zeigen:* Der Schlüssel fehlte bis zum Neukoppeln.
- *ids am Hub nie neu vergeben:* Hilft nicht, wenn die verlorene id nicht die höchste war, und
  AUTOINCREMENT liegt ebenfalls in der Sicherung.
- *Am ELW nach `credential_id` statt nach id zuordnen:* Das ändert die Zuordnung aller bestehenden
  Schlüssel, für einen Sonderfall.

## Risks / Trade-offs

- **[Uhr der zurückgespielten Seite geht nach, und sie vergibt vor der ersten Meldung mehr Stände
  bzw. Änderungen, als verloren gingen]** → Weder D1/D3 noch D2/D4 greifen. Die Stände dazwischen
  erreichen die meldende Seite erst mit ihrer nächsten Änderung. Für Stammdaten hilft „Erneut
  abgleichen“ an der meldenden Seite. Die Kopplung zeigt die Uhrabweichung (`uhr_abweichung_s`).
- **[VM-Snapshot mit laufendem Prozess]** → D3 springt nicht. Bei richtiger Uhr greift D4, denn der
  Log-Zähler steht dann unter dem gemeldeten Stand, bis die Seite mehr Änderungen hat als verloren
  gingen. Danach gilt das Risiko darüber.
- **[Verlorene Schlüssel und Zeilen bleiben an der meldenden Seite]** → Folgeaufgabe LLH-1871. Ein
  verlorener Schlüssel bleibt dort gültig, bis seine id neu vergeben wird (D5) oder ein Admin dort
  neu koppelt.
- **[Einmalige volle Lieferung nach D4]** → Sie läuft in Seiten nach dem bestehenden Budget, über
  mehrere Meldungen. Konten mit Geheimnissen gehen nur unter den Bedingungen von D6 der
  Stammdaten-Verteilung hinaus, wie bei jeder Lieferung.
- **[Eine fehlerhafte Gegenstelle meldet wiederholt Stände knapp über dem Höchsten]** → Jede Meldung
  stempelt und liefert die Org dann neu und überschreibt den Hinweis an der Kopplung. Begrenzt durch
  2³⁹ und die Seitengröße. Schaden an Daten entsteht nicht, weil die Inhalte unverändert sind.
- **[Tests, die kleine feste Stände erwarten]** → Sie werden auf relative Aussagen umgestellt
  (tasks.md).

## Migration Plan

Kein Schema. Ausrollen in beliebiger Reihenfolge. Bestehende Zähler springen mit der ersten Vergabe
(Schlüssel) bzw. dem ersten Start (Log) auf die Unix-Sekunden. Die meldende Seite übernimmt die
großen Stände und meldet sie. Rücknahme durch das alte Binary: Es zählt vom hohen Wert mit +1
weiter, und das bleibt richtig.
