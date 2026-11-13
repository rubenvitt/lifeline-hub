# Design

## Context

Warum: `proposal.md`. Abgestimmt mit dem Menschen am 13.11.2026 (Zunder LLH-1850): Bedienung
im Paneel „Führung“ und Hinweis im Hinweisband; Einsatzleitung oder Admin der Einsatz-Org ohne
Unterschrift; Bruchstelle ist der Widerruf.

Stand im Code:

- `instanz::repo::org_widerrufen` setzt `instanz_kopplung_org.widerrufen_at`, beendet den Abgleich
  der Spiegel (`spiegel::beende_fuer_zuordnung`, an beiden Seiten) und ruft bei einer
  Standardkopplung `fuehrung::repo::release_nach_widerruf`. Auch der Widerruf einer ganzen
  Kopplung läuft je Zuordnung hier durch, `widerrufen_at` steht also immer.
- `release_nach_widerruf` holt nur mit Schalter zurück (LLH-1704). Ohne Schalter bleibt die Akte
  beim widerrufenen Gegenüber, der Spiegel bleibt beendet und gesperrt.
- `repo::list_gegenueber` kennt nur geltende Zuordnungen aktiver Kopplungen. Darum fehlt in
  `FuehrungAnzeige` die `fuehrer_richtung`, `fuehrungText::fuehrungMoeglich` bietet nichts an, und
  `dienst::gegenueber_des_fuehrers` antwortet 409.
- Der Einsatzkopf (`EinsatzFuehrung`) kommt aus den SQL-Makros `fuehrung_spalten!` und
  `fuehrung_joins!` in `src/einsatz/repo.rs`; das Hinweisband (`SpiegelBand.tsx`) liest nur den
  Kopf.

## Goals / Non-Goals

**Goals:**

- Eine Akte, deren Führer nur noch über widerrufene Zuordnungen einer Standardkopplung zur Org
  bekannt ist, erkennt der Server jederzeit aus dem Bestand, ohne Merker.
- Das Zurückholen ergibt dieselbe Akte wie das selbsttätige Rückholen beim Widerruf, bis auf Grund,
  Unterzeichner und Bruchstelle.

**Non-Goals:**

- Akten ohne lokalen Einsatz, die beim Widerruf ohne Schalter stehen bleiben: Sie erscheinen
  nirgends, und eine erneute Kopplung bringt sie in Ordnung. Kein Zurückholen dafür.
- Ein Spiegel, dessen Führer ein Dritter ist, der nur über einen Hub bekannt war: Die Org war mit
  ihm nie über eine Standardkopplung verbunden, also bleibt es wie heute.
- Die Seite „Instanzkopplung“ (Akten des Gegenübers): Dort stehen nur Akten mit geltender
  Zuordnung (`list_fremde_der_org`), und ein Zurückholen braucht den Einsatz hier.

## Decisions

### D1 Eigene Bedienung „Führung zurückholen“ statt eines Zweigs der Notübernahme

Neue Route `POST /api/einsaetze/{id}/fuehrung/zurueckholen` (`GrundBody`, Gate
`EinsatzFuehrungszugriff` wie die Notübernahme) und `dienst::zurueckholen`.

- *Zweig in `notuebernahme_gegen_erreichte`* verworfen: Die Notübernahme richtet sich nach der
  Richtung zum Führer (gegen die meldende Seite mit Beweis), und ihre Texte sagen „Notübernahme
  gegen X“. Hier gibt es kein Gegenüber mehr, das etwas prüft oder annimmt; ein eigener Name macht
  das in Paneel, Admin-Spur und Anwenderdoku sichtbar.
- *Hinweis beim Einschalten mit gespeichertem Merker* verworfen (am Checkpoint): Die Lage lässt
  sich jederzeit aus dem Bestand ablesen; ein Merker müsste zusätzlich gepflegt werden und
  wiche nach einer Wiederherstellung ab.

### D2 Erkennung: „Führung beendet“ aus dem Bestand

Eine Akte gilt als „Führung beendet“, wenn

1. der Schalter an ist, die Akte einen lokalen Einsatz hat und eine andere Instanz nennt,
2. der Spiegel des Einsatzes an einer widerrufenen Zuordnung einer Kopplung mit
   `gegenueber_kennung` = Führer und Art `standard` hängt (`einsatz_spiegel.kopplung_org_id`) und
3. es zur Org keine nicht widerrufene Zuordnung irgendeiner Kopplung zu dieser Kennung gibt.

Bedingung 2 hing im ersten Entwurf an irgendeiner widerrufenen Zuordnung der Org zum Führer. Der
Review vor dem PR fand den Fall dazu: Führt „ELW 1“ und kommt der Spiegel an „ELW 2“ über den Hub,
genügte eine alte, längst widerrufene Standardkopplung von „ELW 2“ zu „ELW 1“, um ohne Beweis
zurückzuholen, während „ELW 1“ weiter führt. Damit der Verweis des Spiegels nach dem Widerruf ohne
Schalter stehen bleibt, lässt `spiegel::fuehrung::richte_aus` beim Einschalten eine widerrufene
Zuordnung zum Führer stehen, statt sie zu leeren; sie nennt auch die Gegenstelle im Hinweisband.

Bedingung 3 nimmt jede Art und jeden Zustand der Kopplung: Ist die Org wieder (oder angebahnt)
zugeordnet, gilt der reguläre Weg über Anfrage oder Notübernahme. Eine unbekannte Art zählt wie
überall als `vor_ort`, also nicht.

Die Bedingung steht genau einmal als SQL-Ausdruck (Makro in `fuehrung::repo`, wie
`fuehrung_spalten!`), den der Einsatzkopf und `repo::find_fuehrung_beendet` benutzen. Letztere
liefert Org-Schlüssel (wie `org_widerrufen` ihn bildet) und `widerrufen_at` der Zuordnung des
Spiegels.

### D3 Vollzug wie `release_nach_widerruf`, aus einer gemeinsamen Funktion

`repo::zurueckholen(conn, a, ich, ZurueckNeu { org_schluessel, grund, unterzeichner, bruch_at, wer })`
setzt nächste Epoche mit eigener Kennung, Art `notuebernahme`, Erklärung ohne Beweis
(`fuehrer_alt` = alte Führung, Grund, Unterzeichner), räumt `offen`, `offen_bruch_at`,
`abgabe_schluessel` und `anfrage_at`, setzt `bruch_at`, speichert (richtet den Spiegel aus) und
schreibt den Verlauf. `release_nach_widerruf` ruft sie mit „Kopplung widerrufen“, leerem
Unterzeichner und `jetzt`; der Mensch mit seinem Grund, seinem Anzeigenamen und dem Widerruf.
Die Erklärung geht vor dem Speichern durch `dienst::erklaerung_text` (ADR-0037): Ein zu langer
Grund ist 422 und lässt die Akte stehen.

Die Erklärung ohne Beweis ist nötig, damit eine dritte meldende Seite, die die Akte über den Hub
kennt, die Übernahme als gegen eine andere Instanz gerichtet erkennt und ohne Alarm offen hält
(ADR-0033, Change `d12cmcx1-hub-epoche-gegen-dritten`, D2).

### D4 Rechte: wer die Führung bedient, ohne Beweis

Gate `EinsatzFuehrungszugriff` (Einsatzleitung oder Admin der Einsatz-Org, Spec „Wer die Führung
bedient“), in beiden Richtungen ohne Unterschrift oder Code. Ein Beweis schützt die meldende Seite
davor, still abgesetzt zu werden; die alte Führung ist hier aber nicht mehr gekoppelt und erfährt
von dieser Akte nichts. Das selbsttätige Rückholen kommt ebenfalls ohne Beweis aus.

- *Nur Admin* verworfen (am Checkpoint): Die Einsatzleitung stünde vor einem gesperrten Einsatz und
  müsste jemanden holen, ohne dass das etwas absichert.

### D5 Bruchstelle: Widerruf der Zuordnung des Spiegels

`bruch_at` = `widerrufen_at` der Zuordnung, an der der Spiegel hängt (D2).
Ab dann kam nichts mehr vom Gegenüber; die Lücke bis zum Zurückholen bleibt im Verlauf sichtbar.

### D6 Anzeige

- `FuehrungAnzeige.fuehrer_beendet_at: Option<String>`: Zeitpunkt aus D5, nur wenn D2 gilt.
  `fuehrungMoeglich` bekommt `zurueckholen` (nicht führend, Einsatz liegt hier, Feld gesetzt).
  Das Paneel zeigt „Kopplung zu X beendet seit …“ und „Führung zurückholen …“ mit Grund-Dialog
  (derselbe Dialog wie die Notübernahme ohne Beweis).
- `EinsatzFuehrung.beendet: bool` im Kopf (D2 als SQL). Das Hinweisband schreibt dann statt
  „Abgleich beendet“ „Kopplung zu X beendet“ und bietet, wer die Führung bedient
  (`darfFuehrungBedienen`), einen Link „Führung zurückholen“ zur Seite Einsatzdaten mit dem Paneel.
- Admin-Spur: vorhandene Aktion `FuehrungNotuebernahme`, Text „Führung zurückgeholt von X
  (Kopplung beendet): <Grund>“. Keine neue Wire-Variante.

### D7 Neue ADR

Die Entscheidung (E1) bekommt ADR-0040 (nächste freie auf `alpha` am 13.11.2026; vor dem PR mit
`scripts/check-adr-nummern.sh` prüfen): „Einen Spiegel ohne gekoppelte Führung holt nur ein Mensch
zurück“.

## Risks / Trade-offs

- [Ein Spiegel, dessen Verweis ein Einschalten vor dieser Änderung schon geleert hat] → Er wird
  nicht als „Führung beendet“ erkannt und bleibt wie vor LLH-1850; Ausweg bleibt eine neue
  Kopplung. Die Lage setzt Widerruf ohne Schalter und Einschalten zwischen LLH-1704 und dieser
  Änderung voraus.
- [Eine neue Kopplung meldet keinen Kopf] → Das Hinweisband ruft den Kopf auch bei beendeter
  Führung im Takt ab und bietet das Zurückholen danach nicht mehr an.

- [Die alte Führung wird erneut gekoppelt und führte inzwischen weiter] → Wie nach dem
  selbsttätigen Rückholen: Die meldende Seite verwirft die Akte ohne Beweis und führt weiter
  (D10), die erreichte Seite nimmt die höhere Epoche an. Das Verhalten ist dasselbe wie heute nach
  einem Widerruf mit Schalter; das Anwenderkapitel sagt, dass ein Zurückholen die Kopplung nicht
  ersetzt.
- [Der Kopf rechnet bei jedem Laden einen zusätzlichen Unterausdruck] → Er läuft nur für Einsätze
  mit fremder Akte (Spiegel) und über die kleinen Tabellen `instanz_kopplung(_org)`.
- [Verwechslung mit der Notübernahme] → Eigener Knopf und eigener Text; die Notübernahme erscheint
  in dieser Lage nicht, weil es kein Gegenüber gibt.

## Migration Plan

Keine Migration und kein Schalter: Die Bedienung erscheint nur in der beschriebenen Lage. Zurück
geht es per Revert; zurückgeholte Akten bleiben gültig, weil sie wie selbsttätig zurückgeholte
aussehen.
