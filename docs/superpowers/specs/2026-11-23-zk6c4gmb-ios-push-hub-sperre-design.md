# iOS-Push: der ELW zeigt die Relais-Sperre seines Hubs (LLH-2074)

Zunder: https://zunder.rubeen.dev/#/aufgabe/zk6c4gmbvmsg8eggqh2xkutb
Herkunft: LLH-1981 (iOS-Alarme über APNs), Abschlussreview Befund M4.

## Anlass und Ziel

Ein ELW, der sich bei einem Hub meldet, schickt Hub-Konten keinen eigenen iOS-Push, sobald der
Hub iOS-Push anbietet (`MeldenAntwort.ios_push`, `instanz_kopplung.gegenueber_ios_push`). Sperrt
das Push-Relais den Hub (`403`, `ios_push_relais.gesperrt_at`), meldet der Hub weiter
`ios_push: true`. iPhones von Hub-Konten bekommen dann bis zu 24 Stunden lang und länger keine
Alarme (`SPERRE_GILT_STUNDEN`), und am ELW merkt das niemand.

**Ziel:** Die Einsatzleitung am ELW sieht im Einsatz, dass iOS-Push über den Hub gerade nicht
zugestellt wird. Dann kann sie wichtige Meldungen auf einem anderen Weg absichern (Funk,
Telefon).

## Ziele, Nicht-Ziele, Anti-Ziele

- **Ziele:** Der Hub meldet seine Sperre bei jedem Abgleich mit. Der ELW zeigt sie
  (1) als Hinweisband im Einsatz für Einsatzleitung und Admins der Einsatz-Org und (2) als
  Warnung an der Kopplung auf der Seite „Instanzkopplung“.
- **Nicht-Ziele:** kein Rückfall, also kein eigener iOS-Push des ELW an Hub-Konten (Gründe unter
  „Ansätze“). Keine neue Benachrichtigungsart und keine Meldung in den Eingang. Kein eigenes
  Live-Ereignis. Keine Änderung am Versand oder an der Sperrlogik des Relais. Kein Hinweis auf der
  Seite „Benachrichtigungen“ des einzelnen Nutzers.
- **Anti-Ziele:** Das Band darf nicht dauerhaft stehen bleiben, nachdem die Sperre gefallen ist.
  Es darf auch nicht bei Einsätzen erscheinen, deren Hinweise gar nicht über einen gesperrten Hub
  reisen. Personen ohne Handlungsmöglichkeit sehen es nicht.

## Randbedingungen

- **Kopplungsprotokoll additiv:** Ein älterer Hub kennt das neue Feld nicht. Dann gilt es als
  „nicht gesperrt“, wie bisher (`#[serde(default)]`). Ein älterer ELW ignoriert das Feld.
- **Rückfall geht nicht:** Die Geräte von Hub-Konten sind am Hub angemeldet. Der ELW lehnt ihre
  iOS-Anmeldung mit 422 ab (`routes/ios_push.rs`, „Gekoppelter ELW“), er hat also kein Token für
  sie.
- **Bezeichner:** Ein neues Feld in einem bestehenden Typ folgt dessen Sprache (deutsch in
  `MeldenAntwort`, `EinsatzAnzeige`, `InstanzKopplungAnzeige`). Ein neuer Response-Typ bekommt
  englische Wire-Felder (`AGENTS.md`, Bezeichner-Sprache).
- **Spalte neu** in `instanz_kopplung` (Migration nach `migrations/AGENTS.md`). Nach den
  DTO-Änderungen `scripts/check-typ-codegen.sh`.

## Ansätze

1. **Sperre reist im Abgleich mit, der ELW zeigt sie an (gewählt, 23.11.2026).** Die Sperre ist
   ein Zustand des Hubs, und der Abgleich trägt schon dessen Fähigkeiten. Sie kommt also auf
   demselben Weg zum ELW. Das ist klein, additiv und erfüllt das Akzeptanzkriterium.
2. *Wie 1, dazu eine einmalige Eingangsmeldung an die Einsatzleitung beim Eintritt der Sperre.*
   Das fällt mehr auf, braucht aber eine neue Benachrichtigungsart, Empfängerauflösung und
   Doppelschutz. Verworfen zugunsten des Bands; bei Bedarf als eigene Aufgabe nachziehbar.
3. *Rückfall: Der Hub meldet bei einer Sperre `ios_push: false`, der ELW pusht selbst.* Das hilft
   nicht, weil der ELW für Hub-Konten keine Anmeldungen hat (s. o.). Die Geräte müssten in der
   iOS-App auf den ELW umgestellt werden, und das ist mitten im Einsatz nicht praktikabel.
   Verworfen.
4. *Bewusst so lassen, nur Risiko R54 ergänzen.* Das erfüllt das Akzeptanzkriterium nicht.
   Verworfen.

## Entwurf

### Hub (erreichte Seite)

- `MeldenAntwort` bekommt `ios_push_gesperrt_seit: Option<String>` (UTC wie `gesperrt_at`,
  `#[serde(default, skip_serializing_if = "Option::is_none")]`).
- `handle_meldung` bekommt den Wert vom Handler `routes::instanz::melden`: Mit `--ios-push` ist
  es `ios_push::repo::relais_gesperrt_seit`, sonst `None`. Eine Sperre zählt, solange
  `gesperrt_at` steht, auch nach Ablauf der 24 Stunden: Bis der nächste Versuch glückt, geht
  nichts hinaus.

### ELW (meldende Seite)

- **Migration:** `instanz_kopplung.gegenueber_ios_push_gesperrt_seit TEXT NULL`.
- `repo::save_faehigkeiten` speichert den Wert aus jeder erfolgreichen Meldung mit; `None`
  löscht ihn. `KopplungZeile` und `KOPPLUNG_SPALTEN` führen die Spalte.
- **Einsatz:** `EinsatzAnzeige.ios_push_hub_gesperrt: Vec<IosPushHubSperre>`, wobei
  `IosPushHubSperre { hub_name, since }` neu ist (englische Wire-Felder). Leer fehlt es
  (`skip_serializing_if = "Vec::is_empty"`; als Pflichtfeld müssten elf Frontend-Fixtures es
  nachtragen). Liste und Detail machen dieselbe Aussage, weil beide dieselbe Spalte lesen. Die
  Menge der
  Kopplungen ist genau die von `spiegel::hinweis::ziele` (aktiv, meldet sich, nimmt Hinweise an,
  Org-Zuordnung nicht widerrufen, kein Spiegel-, Demo- oder abzuräumender Einsatz), dazu
  `gegenueber_ios_push = 1` und `gegenueber_ios_push_gesperrt_seit IS NOT NULL`. Am Spiegel (Hub
  sieht seinen eigenen Einsatz) bleibt es leer. Der Server liefert das Feld an jeden Leser des
  Einsatzes, denn es ist harmlos (Hub-Name und Zeitpunkt). Die Oberfläche entscheidet, wer es
  sieht.
- **Seite „Instanzkopplung“:** `InstanzKopplungAnzeige.gegenueber_ios_push_gesperrt_seit:
  Option<String>`. An der betroffenen Kopplung steht eine Warnzeile.

### Oberfläche

- **Hinweisband im Einsatz**, in `EinsatzLayout` unter dem Führungsband. `warning`, nicht rot
  (Rot ist der Gefahr vorbehalten, wie `FuehrungHinweisband`). Sichtbar, wenn
  `ios_push_hub_gesperrt` nicht leer ist und `darfFuehrungBedienen(einsatz, benutzer)` gilt
  (Einsatzleitung oder Admin der Einsatz-Org). Text-Vorschlag:
  > **iOS-Push über den Hub „<hub_name>“ wird nicht zugestellt.** Das Push-Relais sperrt den Hub
  > seit <zeit>. Alarme erreichen iPhones von Hub-Konten nicht; Web Push und die offene App
  > bleiben. Wichtiges auf anderem Weg absichern und den Betreiber des Hubs informieren.
- **Kopplungszeile:** Kurze Warnung an der Kopplung, gleiche Wortwahl wie
  `iosPushGesperrtText`, aber auf den Hub bezogen („Der Hub wird vom Push-Relais gesperrt (seit
  …); iOS-Push an Hub-Konten kommt nicht an.“). Die Texte liegen in `instanz/instanzText.ts`.

### Aktualität

Der Hub erfährt die Sperre beim ersten Versand mit `403`. Der ELW erfährt sie mit der nächsten
Meldung (Abstand `--instanz-melden-sekunden`, Vorgabe 60 s). Das Band erscheint beim nächsten
Laden des Einsatzkopfs. Fällt die Sperre, verschwindet es auf demselben Weg. Ein eigenes
Live-Ereignis gibt es nicht (Nicht-Ziel). Bricht der Kontakt zum Hub ab, bleibt der letzte Stand
stehen. Der Ausfall der Kopplung selbst zeigt die Seite „Instanzkopplung“ ohnehin.

### Doku

- Kapitel 11, Risiko R54: Der gekoppelte ELW zeigt die Sperre seines Hubs (Band im Einsatz,
  Kopplungsseite). Ein Rückfall auf eigenen Push gibt es bewusst nicht.
- Kapitel 6 oder 8, falls dort der Abgleich der Fähigkeiten beschrieben ist: das neue Feld
  nennen. Die Anwenderdoku zur Instanzkopplung bzw. zu Benachrichtigungen um einen Satz ergänzen,
  wenn ein passendes Kapitel existiert (Regeln in `docs/anwender/AGENTS.md`).
- Die Aufgabe nennt ADR-0084/R48. Das ist die Android-Hülle; für iOS-Push gelten
  [ADR-0090](../../architektur/entscheidungen/ADR-0090-ios-push-laeuft-ueber-ein-relais-mit-ende-zu-ende-verschluesselter-nutzlast.md)
  und R54. Eine neue ADR braucht es nicht, weil die Entscheidung eine Anzeige ist und keine
  Architekturänderung.

## Prüfung (Tests)

- Hub: `handle_meldung` liefert `ios_push_gesperrt_seit` bei gesetzter Sperre und `--ios-push`,
  sonst nicht.
- ELW: `save_faehigkeiten` speichert und löscht den Wert. Eine Antwort ohne das Feld (älterer
  Hub) gilt als „nicht gesperrt“.
- `EinsatzAnzeige.ios_push_hub_gesperrt` ist gefüllt nur für einen gelieferten Einsatz mit
  gesperrtem Hub. Leer ist es ohne Sperre, ohne `gegenueber_ios_push`, bei widerrufener
  Org-Zuordnung, nicht aktiver Kopplung sowie bei Demo- oder Spiegel-Einsatz. Liste und Detail
  sagen dasselbe.
- Frontend: Das Band erscheint für Einsatzleitung und Admin der Org, nicht für andere Rollen und
  nicht bei leerem Feld. Die Kopplungsseite zeigt die Warnzeile.

## Dem Umsetzenden überlassen

- Wie Liste und Detail die Sperren laden (eine Abfrage je Einsatz-Menge statt je Einsatz).
- Die genaue Platzierung der Warnzeile in der Kopplungsliste und der Feinschliff der Texte
  innerhalb des Vorschlags.
- Migrationsnummer nach `migrations/AGENTS.md`.

**Meine Festlegungen (zum Gegenlesen):** Name und Form der Wire-Felder; die Sperre zählt bis zum
erfolgreichen Versand, auch nach Ablauf der 24 h; der Server liefert das Feld an alle Leser, die
Oberfläche filtert; `Vec` statt `Option`, weil ein Einsatz an mehr als einen Hub geliefert werden
kann.
