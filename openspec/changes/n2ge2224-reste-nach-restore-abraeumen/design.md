# Design

## Context

Die Ströme der Meldung, die hier zählen, fließen nur von der erreichten Seite (Hub) zur meldenden
(ELW). Beide liefern nur, was sich seit einem gemeldeten Stand geändert hat:

- **Unterschriftsschlüssel.** `unterschrift::nachlieferung(seit)` liefert die gültigen und
  widerrufenen lokalen Schlüssel mit `stand > seit`. Am ELW ordnet `accept_lieferungen` sie über
  `(kopplung_org_id, fremde_id)` zu (`herkunft = 'gegenueber'`). Ein gelieferter Widerruf setzt
  `zustand = 'widerrufen'`, ein am ELW zurückgewiesener (`abgelehnt`) bleibt es.
- **Stammdaten.** `liefern::nachlieferung(seit)` liest das Änderungslog `stammdaten_aenderung`
  (eine Zeile je `(org_id, art, schluessel)`, auch für gelöschte) und baut je Schlüssel eine
  Lieferung. Was `build_lieferung` nicht als Zeile findet, geht als Löschung: eine Zeile außerhalb
  des Bereichs, ein Stellvertreter- oder Archivkonto, ein Gerätekonto. Am ELW hält
  `stammdaten_herkunft` je Zuordnung fest, welche lokale Zeile zu welchem `fremder_schluessel`
  gehört. `uebernehmen` löscht bei einer Löschung, legt eine verwendete Zeile still oder
  deaktiviert ein Konto und entfernt dabei die Herkunft.

Was der Hub mit einer Sicherung verliert, steht weder in seiner Tabelle noch in seinem Log. Eine
Löschung dafür entsteht nie. Die Abhilfe muss also vom **Bestand** ausgehen, nicht vom Log. Warum,
steht in proposal.md. Die Netze aus LLH-1853 (Change `cz5332jn-unterschrift-stammdaten-nach-restore`,
D2 und D4) sind noch nicht in `alpha`. Diese Change braucht sie nicht.

## Goals / Non-Goals

**Goals:**

- Der ELW räumt ab, was der Hub nicht mehr führt, nach jedem Weg des Zurückspielens und ohne
  Eingriff.
- Eine Gegenstelle älteren Stands bleibt verträglich: nur additive Felder (`src/AGENTS.md`,
  Instanzkopplung: Schema wächst nur additiv), kein `PROTOKOLL`-Sprung, keine Migration.

**Non-Goals:**

- Dass neue Schlüssel und Änderungen nach dem Zurückspielen ankommen (LLH-1853).
- Die Gegenrichtung: Ein zurückgespielter ELW bekommt die verlorenen Zeilen schon heute erneut,
  weil sein gemeldeter Stand mitfällt.
- Die Führungsakten (LLH-1708).

## Decisions

### D1 Der Bestand der Schlüssel geht mit jeder Antwort

`MeldenOrgAntwort` bekommt `unterschrift_bestand: Option<Vec<i64>>`: die ids der lokalen Schlüssel
der Org mit `zustand = 'gueltig'`, gelesen in derselben Transaktion wie die Nachlieferung. Eine
Antwort trägt über alle Orgs höchstens `BESTAND_MAX` (1024) ids. Eine Org, deren Bestand nicht mehr
hineinpasst, bekommt `None`, und das Log warnt. Die Bytes des Bestands gehen wie die der
Schlüssel-Lieferungen vom Budget der Stammdaten ab. So bleibt die größte Antwort unter
`ANTWORT_MAX`, auch bei `ORGS_MAX` Orgs (Test `groesste_antwort_passt_in_die_lesegrenze`).

Warum nur die gültigen: Am ELW kann nur ein Schlüssel wirken, den der Hub als gültig geliefert hat.
Ist er am Hub inzwischen widerrufen, führt das Fehlen in der Liste zum selben Ergebnis wie der
gelieferte Widerruf. Ein Schlüssel, der am Hub auf Gegenzeichnung wartet, ging nie hinaus.

Warum bei jeder Antwort (Abstimmung 13.11.2026): Es sind wenige Schlüssel, und die Liste wirkt nach
jedem Weg des Zurückspielens, ohne dass der Hub den Rückschritt erkennen muss.

**Verworfen:**

- *Nur nach einem erkannten Rückschritt* (Netz aus LLH-1853, D2): Ein neuer Schlüssel vor der
  ersten Meldung hebt den Stand über den gemeldeten, und der Rückschritt bleibt unerkannt.
- *Paare aus id und `credential_id`:* Sie fingen auch eine neu vergebene id ab, aber das leistet
  schon D5 aus LLH-1853 an der Zuordnung selbst. Hier bliebe es doppelt.

### D2 Der ELW widerruft, was in der Liste fehlt

Nach `accept_lieferungen` und in derselben Transaktion ruft `melden_einmal_mit`
`unterschrift::revoke_fehlende(conn, kopplung_org_id, &bestand, jetzt)` auf, wenn die Antwort für
die Org einen Bestand trägt. Eine einzige Anweisung (`fremde_id NOT IN (SELECT value FROM
json_each(?))`, `src/AGENTS.md`, Listen von außen) setzt jeden Schlüssel dieser Zuordnung mit
`zustand IN ('gueltig', 'wartet_auf_bestaetigung')` auf `widerrufen` (`widerrufen_at` gesetzt,
`stand` unverändert). Sie liefert Inhabername und Fingerabdruck der widerrufenen Schlüssel zurück.

- `abgelehnt` und `widerrufen` bleiben, wie sie sind (wie beim gelieferten Widerruf).
- Je widerrufenem Schlüssel ein Eintrag `UnterschriftWiderrufen` über
  `admin_audit::schreibe_ohne_akteur` mit dem Grund „führt <Gegenüber> nicht mehr“. Dazu ein
  Hinweis an der Kopplung (`repo::set_hinweis`).
- `check_antwort` lehnt mehr als `BESTAND_MAX` ids je Antwort ab, wie die übrigen Grenzen der Antwort.
- Fehlt das Feld (`None`, Gegenstelle älteren Stands), geschieht nichts. Eine leere Liste dagegen
  heißt: Der Hub führt keinen gültigen Schlüssel der Org mehr.

### D3 Prüfsumme der übernommenen Zeilen in der Meldung

`MeldenOrg` bekommt `stammdaten_pruefsumme: Option<String>`. Der ELW setzt sie nur für eine Org, deren
Stammdaten er aus dieser Zuordnung bezieht (`stammdaten_stand >= 0`). Sie sind die ersten 128 Bit (32 Zeichen hex) von
SHA-256 über die nach `(art, schluessel)` sortierten Zeilen `art \x1f schluessel \n` aus
`stammdaten_herkunft` der Zuordnung. 128 Bit genügen, um eine Abweichung zu erkennen, und halten die
Meldung unter `extractor::BODY_MAX` (64 KiB, davon bis zu 40 KiB Führungsakten). Gebildet wird sie in einer gemeinsamen Funktion `stammdaten::bestand::pruefsumme`, die
auch der Hub benutzt. Ändert sich dort die Form, ändern sich beide Seiten gemeinsam.

**Verworfen:**

- *Der Hub schickt eine Prüfsumme, der ELW fragt nach:* braucht einen Merker am ELW und eine
  Runde mehr.
- *Die Liste bei jeder Meldung:* bei einigen tausend Zeilen rund 100 KB je Minute und ELW.
- *Nur nach einem erkannten Rückschritt oder auf Knopfdruck* (Abstimmung 13.11.2026): verfehlt den
  Rückschritt, wenn der Hub vor der ersten Meldung ändert, oder braucht einen Menschen am ELW.

### D4 Der Bestand des Hubs ist, was er als Zeile liefern würde

`stammdaten::bestand::load(conn, org_id, arten)` liest je Art aus `art::BESCHREIBUNGEN` die
Schlüssel der Zeilen der Org (`CAST(id AS TEXT)`, die Schlüsselspalte, bei `Schluessel::Org` `''`).
Dabei gilt die Bedingung `bereich`, Konten ohne Stellvertreter (`spiegel_konto`), Archivkonten
(`archiv_konto`) und Gerätekonten (`geraet_kopplung`). Geschnitten wird mit den Schlüsseln der Org im
Änderungslog: Was nie im Log stand, ging nie hinaus.

Es gilt: Ein Schlüssel steht genau dann im Bestand, wenn `build_lieferung` für ihn keine Löschung
baut. Ein Unit-Test prüft das je Art an einer Org mit Daten jeder Art. Weicht der Bestand davon ab,
löschte der ELW eine Zeile, die der Hub noch liefert, und sie käme erst mit ihrer nächsten Änderung
wieder.

### D5 Die Liste geht nur bei Abweichung und auf aktuellem Stand

`handle_meldung` prüft je aktiver Org, nach der Nachlieferung und in derselben Transaktion:

1. Die Meldung trägt eine Prüfsumme, die Kopplung trägt Stammdaten, `stammdaten_stand >= 0`.
2. Der ELW hat alle Änderungen: `stammdaten_stand >= MAX(stand)` der Log-Zeilen der Org in den
   Arten der Meldung (eine Art, die er nicht kennt, erreicht er nie). Solange
   die Nachlieferung läuft, weicht die Prüfsumme ohnehin ab, und die Liste wäre Ballast. Nach einem
   Zurückspielen liegt der gemeldete Stand über dem Höchsten, und die Bedingung gilt.
3. Die eigene Prüfsumme über den Bestand (D4, nur Arten der Meldung) weicht ab.
4. Die Sendebremse erlaubt es (D6).
5. Die Liste passt ins Restbudget der Stammdaten.

Dann trägt `MeldenOrgAntwort` `stammdaten_bestand: Option<Vec<StammdatenBestand>>`, ein Eintrag je
geprüfter Art mit `art` und allen `schluessel`, auch mit leerer Liste. Der ELW räumt nur Arten ab, die
darin stehen. Passt die Liste nicht, bleibt sie aus und das Log warnt.

### D6 Sendebremse im Speicher

Ein prozessweiter `Mutex<HashMap<(String, i64), (String, Instant)>>` merkt sich je eigener
Instanzkennung und Kopplungs-Org die Prüfsumme der meldenden Seite und den Zeitpunkt der letzten
Liste. Die Liste geht, wenn es keinen Eintrag gibt, die Prüfsumme eine andere ist oder 10 Minuten
vergangen sind. Eingetragen wird erst nach dem Commit von `write_retry`: Die Closure kann wiederholt
werden, und ein Eintrag aus einem verworfenen Versuch unterdrückte die Liste.

Warum die Instanzkennung im Schlüssel: Die Integrationstests fahren mehrere Instanzen in einem
Prozess, und deren `kopplung_org_id` überschneiden sich.

**Verworfen:** *Eine Spalte an `instanz_kopplung_org`:* eine Migration für einen Merker, der einen
Neustart nicht überdauern muss. Nach einem Neustart geht die Liste höchstens einmal mehr.

### D7 Der ELW räumt über den Löschweg der Übernahme ab

Trägt die Antwort einen Stammdaten-Bestand, bildet `melden_einmal_mit` nach der regulären
Übernahme aus `stammdaten_herkunft` der Zuordnung jede `(art, fremder_schluessel)` einer gelisteten
Art, die in der Liste fehlt, als Lieferung mit `geloescht: true`. Diese gehen durch
`uebernehmen::uebernehmen`. So gelten dieselben Regeln wie für eine gelieferte Löschung:
Reihenfolge nach Rang, Nachholen am Verweis, Stilllegen, Konto deaktivieren samt
`deaktivierte_konten`, Ereignis `stammdaten`. Der Stand der Zuordnung bleibt unberührt. Wurde
etwas abgeräumt, kommt ein Hinweis an die Org-Zuordnung (`repo::add_stammdaten_hinweise`):
„<n> Zeilen, die <Gegenüber> nicht mehr führt, wurden entfernt oder stillgelegt.“

`check_antwort` begrenzt die Liste: höchstens `ARTEN_MAX` Arten je Org und höchstens
`BESTAND_STAMMDATEN_MAX` (100 000) Schlüssel je Antwort. Unbekannte Arten überspringt der ELW. Die
Liste wird nur gegen den eigenen Bestand gelesen, sie steuert keine Abfrage mit externer Länge.

**Verworfen:** *Ein eigener Löschweg für das Abräumen:* Er müsste Stilllegen, Konten und Nachholen
nachbauen und drifte vom Löschweg der Lieferung ab.

## Risks / Trade-offs

- **[Der Bestand des Hubs weicht von dem ab, was er liefert]** → Der ELW löschte eine geführte
  Zeile. Abhilfe: Unit-Test aus D4 über alle Arten. Eine neue Art mit Sonderregel in
  `build_lieferung` macht ihn rot.
- **[Bleibende Abweichung, etwa eine Zeile, die der ELW nicht übernehmen konnte]** → Die Liste geht
  alle 10 Minuten. Das kostet höchstens die Größe der Liste. Am Zustand ändert es nichts, weil am ELW
  nichts fehlt, was zu löschen wäre.
- **[Eine Zeile am ELW wurde im ersten Abgleich mit einer eigenen zusammengeführt]** → Verliert der
  Hub sie, verschwindet am ELW auch die eigene Zeile, wie bei einer Löschung am Hub. So gilt es
  schon heute.
- **[Der Hub vergibt nach dem Zurückspielen die id eines verlorenen Schlüssels neu]** → Die id steht
  in der Liste, der alte Schlüssel bleibt am ELW, bis der neue ankommt und D5 aus LLH-1853 ihn
  ersetzt. Bis LLH-1853 in `alpha` ist, bleibt diese Lücke.
- **[Last am Hub]** → Bei jeder Meldung eines ELW auf aktuellem Stand eine Abfrage je Art und eine
  über das Log der Org, dazu SHA-256 über einige tausend kurze Zeilen. Das sind wenige
  Millisekunden je Minute und ELW.
- **[Die Liste passt nicht ins Budget]** → Sie bleibt aus, das Log warnt. Bei einigen zehntausend
  Zeilen einer Org; heute nicht in Sicht.
- **[Konflikt beim Zusammenführen mit LLH-1853]** → Beide ändern `handle_meldung` an derselben
  Stelle. Wer zuletzt merged, holt `alpha` nach und passt an.

## Migration Plan

Kein Schema. Ausrollen in beliebiger Reihenfolge: Ein Hub ohne diese Change schickt keine Liste und
liest keine Prüfsumme. Ein ELW ohne sie meldet keine Prüfsumme und ignoriert die Listen. Rücknahme
durch das alte Binary ohne Folgen. Schon abgeräumte Zeilen und widerrufene Schlüssel bleiben es.
