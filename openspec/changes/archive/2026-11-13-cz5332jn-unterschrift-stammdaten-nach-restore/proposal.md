# Proposal

## Why

Wird ein Hub aus einer Sicherung zurückgespielt, erreichen danach neue Unterschriftsschlüssel,
Widerrufe von Schlüsseln und Stammdaten-Änderungen den gekoppelten ELW nicht mehr (LLH-1853,
Folge von LLH-1708). Beide Ströme liefern ab einem Stand, den der ELW meldet, und ihre Zähler fallen
mit der Sicherung unter diesen Stand. Die drei Tests `zurueckgespielt_hub_*` in
`tests/instanz_kopplung.rs` und `tests/instanz_stammdaten.rs` belegen das. Ein Widerruf, der nicht
ankommt, lässt einen Schlüssel am ELW gültig, den die Org zurückgezogen hat. Das ist
sicherheitsrelevant, und es geschieht ohne Hinweis, gerade nach einem Ausfall.

Dazu kommt eine zweite Lücke bei den Schlüsseln: Die Tabelle `unterschrift_schluessel` vergibt ids
ohne AUTOINCREMENT. Ein neuer Schlüssel am zurückgespielten Hub bekommt die id eines verlorenen, und
der ELW hielte ihn auch mit richtigem Stand für schon bekannt.

## What Changes

- **Der Zähler der Unterschriftsschlüssel folgt der Uhr** (abgestimmt am 13.11.2026, Muster D1 von
  LLH-1708). Ein neuer Stand ist der größere Wert aus „höchster Stand der Org + 1“ und den
  Unix-Sekunden jetzt. Das gilt für neue, gegengezeichnete und widerrufene Schlüssel.
- **Netz für eine nachgehende Uhr bei den Schlüsseln.** Meldet die meldende Seite für eine Org einen
  höheren Stand, als die erreichte Seite je vergeben hat, wurde die erreichte Seite zurückgespielt.
  Sie stempelt dann ihre gültigen und widerrufenen Schlüssel der Org über den gemeldeten Stand neu
  und liefert sie erneut. Die Kopplung zeigt einen Hinweis.
- **Ein anderer Schlüssel unter bekannter id ersetzt den alten.** Liefert das Gegenüber unter einer
  id, die der ELW schon kennt, einen anderen Schlüssel, widerruft der ELW den alten und prüft den
  neuen wie jeden neuen: mit Gegenzeichnung und dann „wartet auf Bestätigung“.
- **Der Zähler des Stammdaten-Änderungslogs springt beim Start auf die Uhr.** Zurückspielen per
  `restore` oder durch Zurückkopieren der Datei verlangt einen Neustart. Danach liegt jede neue
  Änderung über allem, was der ELW vor dem Ausfall übernommen haben kann.
- **Netz für eine nachgehende Uhr bei den Stammdaten.** Meldet die meldende Seite für eine Org einen
  höheren Stand als den höchsten Log-Stand dieser Org, stempelt die erreichte Seite alle Log-Zeilen
  der Org über den gemeldeten Stand neu und liefert die Org einmal ganz. Die Kopplung zeigt einen
  Hinweis.
- Keine Migration, kein neues Feld in der Meldung. Eine Gegenstelle älteren Stands bleibt
  verträglich.
- **Tests:** Integrationstests mit zwei Instanzen spielen je Strom eine Sicherung am Hub zurück,
  dazu den ELW. Neue Schlüssel, Widerrufe und Stammdaten-Änderungen erreichen danach den ELW.
- **Nicht enthalten:** Zeilen und Schlüssel, die der Hub mit der Sicherung verlor und der ELW schon
  hatte, bleiben am ELW stehen. Das löst die Folgeaufgabe LLH-1871.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `org-admin-unterschrift`: neue Anforderung. Neuzugänge und Widerrufe von
  Unterschriftsschlüsseln erreichen das Gegenüber auch nach dem Zurückspielen einer Sicherung, und
  ein anderer Schlüssel unter bekannter Kennung ersetzt den alten.
- `stammdaten-verteilung`: neue Anforderung. Stammdaten-Änderungen erreichen die meldende Seite
  auch nach dem Zurückspielen der erreichten Seite.

## Impact

- **Code:** `src/auth/unterschrift/repo.rs` (`next_stand`, neues Stempeln, `accept_lieferungen`),
  `src/instanz/stammdaten/` (Sprung des Log-Zählers, neues Stempeln einer Org),
  `src/instanz/melden.rs` (`handle_meldung`: Netz vor der Nachlieferung), `src/main.rs` (Sprung
  beim Start).
- **Protokoll:** unverändert. Stände der Schlüssel und des Logs werden groß (um 1,8 Mrd.). Die
  Gegenstelle speichert sie wie bisher als `INTEGER`.
- **Daten:** Bestehende Zähler springen mit der ersten Vergabe bzw. dem ersten Start nach dem
  Update auf die Unix-Sekunden. Ein ELW, der eine id des Gegenübers schon kennt, kann einen
  Schlüssel als widerrufen markieren, den der Hub ersetzt hat.
- **Folgeaufgabe:** LLH-1871 (Reste am ELW nach dem Zurückspielen des Hubs abräumen).
