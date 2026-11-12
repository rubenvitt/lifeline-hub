# Design

Zunder: https://zunder.rubeen.dev/#/aufgabe/t10a7luhp4fctv9l8y4maeds (LLH-1497). Lösungsweg mit
Ruben am 12.11.2026 abgestimmt (vier Fragen, jeweils die Empfehlung). Folgeaufgabe für den
Führungswechsel zwischen zwei ELW: LLH-1678.

## Context

Motivation: `proposal.md`, „Why“. Für das Vorgehen zählt Folgendes.

**Kopplung (LLH-1490, ADR-0014)**
- Die einlösende Seite (`meldet_sich`) baut jede Verbindung auf. Die ausstellende Seite
  (`wird_gemeldet`) antwortet nur.
- Jede Anfrage und Antwort ist ein EdDSA-JWS mit Body-Hash und `jti`.
- Die Antwort auf `POST /api/instanz/koppeln` ist signiert. Der Schlüssel der ausstellenden
  Seite ist über den Prüfwert an den Code gebunden.
- Der ausgehende Client ist ein reqwest-Client je Prozess (`melden::client`) mit dem
  Plattform-Verifier. `normalize_adresse` verlangt `https://`, außer für Loopback.

**Richtung statt Rolle.** Alles Hub-artige folgt allein aus der Richtung:
- `austausch::entscheide`: Die erreichte Seite nimmt jede neue Epoche an.
- `lebensende::faellige_verwahrungen`: Verwahrung geht nur von der meldenden zur erreichten
  Seite.
- `stammdaten::herkunft::find_quelle`: Die Quelle ist die älteste aktive `meldet_sich`-Kopplung.
- `stammdaten::geheimnis::is_org_verteilend` legt die Passkey-Pflicht fest.
- „ELW verloren“ gibt es nur an der erreichten Seite.

**Abbildung von Stammdaten (LLH-1492, `spiegel/abbildung.rs`)**
- Nur die meldende Seite kennt `stammdaten_herkunft`. Deshalb übersetzt sie in beide Richtungen
  (`stammdaten_fremd`, `stammdaten_lokal`).
- Ohne Gegenstück bleibt ein Verweis leer. Ein Konto wird dann zum Stellvertreter, ein Antrag
  scheitert mit „Konto am Führer unbekannt“.

**TLS ist eingebaut** (`--tls`, `src/tls/mod.rs`): Reihenfolge BYO → Cache → mkcert → rcgen.
Ändern sich die SANs (etwa die Bind-IP), entsteht ein neues Zertifikat (`cache_passend`).

**mDNS:** Keine Crate, kein Code. Die Doku sagt ausdrücklich „stellt sich nicht per mDNS vor“.

## Goals / Non-Goals

**Goals:**
- Zwei Instanzen im selben LAN koppeln ohne eingetippte Adresse und ohne öffentlich vertrautes
  Zertifikat, und ein Angreifer im LAN kann dabei weder mitlesen noch sich dazwischenschalten.
- Auf einer Direktkopplung wirkt keine der Hub-artigen Nebenwirkungen der Richtung.
- Konten und Stammdaten, die zwei Instanzen aus derselben Quelle haben, gelten über jede Kopplung
  als dieselben.

**Non-Goals:**
- Führungswechsel über eine Direktkopplung (LLH-1678). Dazu gehört, dass der Hub einen Wechsel
  zwischen zwei ELW nachzieht.
- Beglaubigtes Zertifikat hinter einem Reverse-Proxy. Die Instanz kennt das Zertifikat des
  Proxys nicht, also gibt es eine Direktkopplung nur mit `--tls`.
- Weiterleiten über mehrere Instanzen. Gespiegelt wird nur vom unmittelbar gekoppelten Führer.
- Entdeckung über andere Wege als mDNS: QR-Code, Broadcast, Overlay-Netz.
- Zertifikats-Pinning für Standardkopplungen.
- Ein eigener Entwurf mit `/design`. Die Oberfläche ergänzt die vorhandene Seite um einen
  Schalter, eine Liste, einen Chip und einen Hinweis. Es gibt keine neue Seite und kein neues
  Modul (`frontend/AGENTS.md`, „Größere UI-Entwürfe“).

## Decisions

### D1 Art als Spalte der Kopplung, gewählt am Code

`instanz_kopplung.art` und `instanz_kopplungscode.art` sind `TEXT NOT NULL DEFAULT 'standard'`
mit `CHECK (art IN ('standard','vor_ort'))`. Im Code wird daraus ein Wire-Enum
`InstanzKopplungArt` (ADR-0006).

**Wie die Art festgelegt wird**
- Der Admin wählt sie beim Ausstellen.
- Die signierte `KoppelnAntwort` trägt `art`. Die einlösende Seite übernimmt sie.
- Ist `art = vor_ort` und nennt die `KoppelnAnfrage.protokoll` weniger als 3, antwortet die
  ausstellende Seite mit 426. Sie verbraucht den Code nicht und speichert keine angebahnte
  Kopplung.
- Ein zweiter Code für dieselbe Gegenstelle mit anderer Art endet mit 409.

**Verworfene Alternativen**
- *Art als Merkmal der Instanz* (`--rolle hub|elw`) widerspricht Entscheidung 13 und der
  Anforderung „Die Kopplung kennt Richtung, nicht Hub und ELW“. Eine Instanz braucht beide Arten
  zugleich: ELW 2 ist beim Hub `standard` und bei ELW 1 `vor_ort`.
- *Beide Seiten wählen die Art* (Abgleich beim Einlösen): doppelte Bedienung, und der Code
  trägt die Absicht ohnehin schon.

### D2 Ein Prädikat für die Flüsse einer Art

`InstanzKopplungArt::traegt(Fluss) -> bool` mit den Flüssen `Stammdaten`, `Geheimnisse`,
`Verwahrung` und `Fuehrungswechsel`. Für `vor_ort` ist jeder `false`, für `standard` jeder
`true`.

**Wo das Prädikat greift**
- `find_quelle` und Liefern der Stammdaten an der erreichten Seite
- `is_org_verteilend`
- „ELW verloren“: Route und Oberfläche
- `faellige_verwahrungen`, außerdem die Annahme von `verwahrt` an der erreichten Seite
- Ziele der Übergabe (`fuehrung::repo`)
- Anfrage, Notübernahme und Abgabecode (`fuehrung::dienst`, 409)
- `austausch` (D4)

Ein Wächter-Test zählt jeden Aufruf je `Fluss`. Verliert eine Stelle die Prüfung, wird er rot.

**Verworfene Alternative:** Einzelne `if art == VorOrt` an jeder Stelle. Das läuft auseinander,
sobald ein fünfter Fluss dazukommt.

### D3 Zertifikat durch signierte Aussage beglaubigt

Fingerabdruck ist SHA-256 über das DER des Endzertifikats, hex. Der Server berechnet ihn beim
Start aus dem Zertifikat, das er ausliefert, und hält ihn in `AppState`. Ohne `--tls` bleibt er
leer.

**Gespeichert:** `instanz_kopplung.tls_zertifikat TEXT NULL`, nur bei `meldet_sich` und
`vor_ort`.

**Verifier.** Ein eigener `rustls::client::danger::ServerCertVerifier`:
- Die Handshake-Signaturen prüft er wie rustls selbst (`verify_tls12_signature`,
  `verify_tls13_signature` mit dem Standard-Crypto-Provider).
- Kette und Hostname prüft er nicht.
- Er vergleicht den Fingerabdruck mit dem erwarteten Wert. Im Erfassungsmodus ohne
  erwarteten Wert merkt er ihn sich nur.

Für Direktkopplungen baut `melden` den Client darüber (`use_preconfigured_tls`) und cacht ihn je
Fingerabdruck. Standardkopplungen behalten den bisherigen Client.

**Beim Koppeln**
1. Die einlösende Seite ruft im Erfassungsmodus auf.
2. Die signierte Antwort nennt `tls_zertifikat`.
3. Passt der Wert nicht zum gemerkten Fingerabdruck, wird abgebrochen und keine Kopplung
   gespeichert. Die ausstellende Seite verwirft ihre angebahnte Kopplung nach 15 Minuten wie
   heute.

Den Code sieht ein Angreifer nie. Das Einzige, was er lesen kann, ist der öffentliche Schlüssel
der einlösenden Seite, und der ist nicht geheim.

**Bei einem Wechsel des Zertifikats**
1. Der Verifier meldet „Fingerabdruck passt nicht“.
2. `melden` ruft im Erfassungsmodus die neue signierte Route `POST /api/instanz/zertifikat` auf
   (leerer Body, `GekoppelteInstanz`).
3. Die Antwort ist signiert und nennt den aktuellen Fingerabdruck. Passt er zum gesehenen
   Zertifikat, wird er gespeichert, ein Eintrag geht in die Admin-Spur, und es wird erneut
   gesendet. Sonst wird nichts gesendet, und die Kopplung zeigt „Zertifikat passt nicht“.

Ein Angreifer, der weiterreicht, liefert die echte Aussage über das echte Zertifikat. Die passt
nicht zu seinem eigenen. Die Anfrage selbst verrät nur Kennungen.

**Anzeige an der erreichten Seite.** Die meldende Seite nennt in jeder Meldung den gespeicherten
Fingerabdruck. Die erreichte Seite vergleicht ihn mit ihrem eigenen und zeigt „Zertifikat
bestätigt“ oder „Gegenstelle kennt ein älteres Zertifikat“.

**Verworfene Alternativen**
- *SPKI statt ganzes Zertifikat:* bräuchte einen X.509-Parser. Ein neues Zertifikat mit
  demselben Schlüssel ist selten und läuft ohnehin über die Bestätigung.
- *Neues Zertifikat vorab in der Meldung ankündigen* (so am Checkpoint skizziert): Ein
  rcgen-Zertifikat entsteht erst beim Neustart nach dem IP-Wechsel, vorher kennt es niemand. Die
  signierte Rückfrage deckt denselben Fall ab, ohne Vorwissen. Dieses Detail weicht vom
  Checkpoint ab und wird bei der Freigabe benannt.
- *http im privaten Netz:* Art.-9-Daten gingen im Klartext durchs WLAN.
- *Nur eine eigene CA:* Im Feld nicht zu betreiben.

### D4 Austausch der Akten auf einer Direktkopplung

In `austausch` gilt je eingehender Akte über eine Kopplung `vor_ort`, unabhängig von der
Richtung:

| Akte | Bisher (Richtung) | Auf `vor_ort` |
| --- | --- | --- |
| Führer wechselt zwischen mir und dem Sender (beide Richtungen) | erreichte Seite nimmt an, meldende braucht Beweis | verwerfen, Hinweis an der Kopplung |
| Sender führte bisher und nennt eine dritte Instanz mit höherer Epoche | erreichte Seite: übergehen; meldende: Anzeige | annehmen (der bisherige Führer bezeugt seine Abgabe) |
| Von einer Dritten weitergereicht | nur Anzeige | unverändert |
| Neuer Einsatz (Epoche 1, Sender führt) | annehmen | unverändert |

`entscheide` bekommt die Art als Parameter. Die Tabelle wird mit Tests als reine Funktion
festgehalten, wie D7 aus LLH-1491. Nach dem Annehmen einer Abgabe an eine Dritte folgt der
Spiegel über `spiegel::fuehrung::richte_aus` der neuen Kopplung, oder er bleibt mit „Die
führende Instanz ist hier nicht gekoppelt.“ stehen (vorhandener Weg).

**Verworfene Alternative:** Akten auf einer Direktkopplung gar nicht austauschen. Dann wüsste
der Spiegel nicht, wer führt, und „Einsätze beim Gegenüber“ bliebe leer.

### D5 Ursprungskennung `<instanzkennung>/<schlüssel>`

Der Schlüssel ist der aus `stammdaten_aenderung`, je Art eindeutig. Die Kennung folgt dem Muster
von `einsatz.kennung` und den Org-Kennungen.

**Speichern**
- Lokal angelegte Zeilen speichern nichts. Ihre Ursprungskennung ist `<ich>/<lokaler_schlüssel>`.
- Übernommene Zeilen bekommen `stammdaten_herkunft.ursprung TEXT`, mit Index
  `(org_id, art, ursprung)`.
- Die Stammdaten-Lieferung trägt je Zeile `ursprung`. Liefert eine Instanz eine übernommene
  Zeile weiter, nennt sie den gespeicherten Ursprung und nicht sich selbst.
- Die Migration füllt bestehende Herkunft mit `<gegenueber_kennung>/<fremder_schluessel>`. Das
  stimmt, solange die Quelle die Zeile selbst angelegt hat, und das ist heute der Fall.
- Spricht die Quelle zum ersten Mal Protokoll 3, setzt die meldende Seite ihren Stammdatenstand
  für diese Org-Zuordnung einmal auf 0. Die nächste Lieferung berichtigt dann jede Zeile.

**Abbilden.** Neu ist `abbildung::nach_ursprung(conn, org_id, art, ursprung)`:
- Eigenes Präfix: die lokale Zeile der Org. Bei Konten nie ein Stellvertreter.
- Sonst: `stammdaten_herkunft` mit `(org_id, art, ursprung)`.

Die Ursprungskennung ist immer der letzte Versuch vor dem bisherigen Ausgang (leer bzw.
Stellvertreter oder Ablehnung):

| Stelle | Neuer letzter Versuch |
| --- | --- |
| `uebernehmen` (`Ziel::Stammdaten`, Qualifikationslisten) | Ursprung, sonst leer |
| `abbildung::konto_lokal` | Ursprung, sonst Stellvertreter |
| `antrag` (Konto) | Ursprung, sonst Ablehnung |
| `antrag` (`AntragZiel::Stammdaten`, heute nur die Einheitsvorlage beim Eintreffen) | Ursprung, sonst leer |

**Auf dem Draht**
- `Zeile.ursprung`: Liste von `{spalte, wert, ursprung}`, `wert` = die ID beim Absender
- `KontoAngabe.ursprung`
- `Antrag.ursprung` für Verweise auf Stammdaten

Alle Felder sind optional (`serde(default)`). Eine Gegenseite mit Protokoll 2 überliest sie. Der
Absender setzt sie für jeden Verweis auf Stammdaten, auch auf Standardkopplungen. Die Kosten sind
klein, und ein Hub, der zwei ELW sieht, profitiert davon.

**Vertrauen.** Eine gekoppelte Instanz kann schon heute per `gegen_id` jedes echte Konto der Org
benennen. Die Ursprungskennung erweitert dieses Vertrauen nicht. Sie gilt nur innerhalb der Org
des Einsatzes und nie für Stellvertreter.

**Verworfene Alternativen**
- *Natürliche Schlüssel* (Funkrufname, Personalnummer, Benutzername): nicht für jede Art
  vorhanden und änderbar.
- *Stammdaten auch über die Direktkopplung verteilen:* zwei Quellen für eine Org, gegen
  Entscheidung 10.
- *Nur Konten:* Fahrzeuge und Vorlagen blieben im Spiegel leer.

### D6 Entdeckung mit `mdns-sd`

Neues Modul `src/instanz/entdeckung.rs` mit der Crate `mdns-sd`: reines Rust, eigener
Daemon-Thread, MIT/Apache-2.0, Version fest.

**Start**
- Gestartet wird in `main.rs` nur mit `--lan-entdeckung` und `--tls`, und nur wenn der Bind
  nicht Loopback ist. Sonst steht eine Zeile im Log, und kein Daemon läuft.
- Dienst `_lifeline-hub._tcp.local.`, Instanzname `<instanzname> (<kennung kurz>)`.
- TXT-Einträge: `k` Kennung, `n` Name, `f` Fingerabdruck des Instanzschlüssels (wie auf der
  Seite „Instanzkopplung“), `pv`.
- Bei `0.0.0.0` kündigt der Dienst alle Adressen der Schnittstellen an.

**Suchen**
- `suche(dauer)` liefert die gefundenen Instanzen ohne die eigene und markiert schon gekoppelte.
- Route `GET /api/admin/instanz/lan`, nur für Admins. Sie sucht 3 s. Ohne Schalter kommt
  `{aus: true}`.
- `suche_kennung(kennung, dauer)` dient dem Neuauflösen. `melden` ruft sie für eine
  Direktkopplung nach einem Netzfehler auf, höchstens einmal je Backoff-Stufe. Eine neue Adresse
  gilt erst nach einer signierten Antwort und landet in der Admin-Spur.

**Adressen:** Bevorzugt IPv4, dann IPv6 ohne Link-Local, als
`https://<ip>:<port>`. `normalize_adresse` lässt IP-Literale schon heute zu.

**Verworfene Alternativen**
- *`libmdns`/`zeroconf`:* nur Ankündigen bzw. C-Bindung an Avahi/Bonjour, schlecht für das
  statische Binary.
- *Eigener UDP-Broadcast:* eigenes Protokoll ohne Gewinn.
- *Immer an:* jede Instanz wäre im Netz sichtbar, auch ungekoppelt. Abgestimmt ist „Schalter,
  aus“.

### D7 Protokoll 3

`PROTOKOLL = 3`. Neu sind Art und Fingerabdruck beim Koppeln, `POST /api/instanz/zertifikat`,
der Fingerabdruck in der Meldung und die Ursprungskennungen. N/N−1 bleibt:
- Standardkopplungen mit 2 arbeiten weiter.
- Die neuen Felder sind optional.
- Eine Direktkopplung verlangt 3 an beiden Seiten (D1).

`PROTOKOLL_SPIEGEL` bleibt 2.

### D8 Oberfläche

Alles bleibt auf der Seite „Instanzkopplung“ und im Paneel „Führung“, mit vorhandenen
Bausteinen.

- **Code ausstellen:** Wahl „Direktkopplung vor Ort“ mit Erklärtext. Ohne `--tls` ist sie
  gesperrt und nennt den Grund. Die Identitäts-Antwort meldet dafür `tls_zertifikat` vorhanden
  ja/nein.
- **Code einlösen:** Knopf „Im Netz suchen“ und eine Liste mit Name, Fingerabdruck, Adresse und
  der Markierung „schon gekoppelt“. Ein Klick übernimmt die Adresse. Ist der Schalter aus, zeigt
  die Liste „LAN-Entdeckung ist aus“.
- **Kopplungskarte:**
  - Chip „vor Ort“
  - Zeile „Zertifikat“: „bestätigt“, „passt nicht“ oder „Gegenstelle kennt ein älteres
    Zertifikat“
  - kein „ELW verloren“
- **Paneel „Führung“:** Eine Gegenstelle vor Ort fehlt als Ziel. Der Hinweis lautet „<Name>
  ist vor Ort gekoppelt: Führungswechsel dorthin kommt später“.
- Texte liegen in `instanzText.ts`, Query-Keys in der Registry (`frontend/AGENTS.md`).

### D9 Regel als ADR

ADR-0029 „Auf einer Direktkopplung beglaubigt eine signierte Aussage das TLS-Zertifikat“.

**MUST-Regeln**
- Nutzdaten nur über eine Verbindung mit beglaubigtem Fingerabdruck
- Bei Abweichung zuerst die Bestätigung über `POST /api/instanz/zertifikat`
- Eine Ankündigung ersetzt nie Code und Prüfwert

**Prüfzeilen** (`verlange`/`verbiete`) gegen den Verifier und die Route. Die ADR gilt für
`src/instanz/melden.rs`, `src/instanz/zertifikat.rs` und `src/instanz/entdeckung.rs`.

**Zugleich**
- ADR-0014 bekommt einen Verweis.
- `docs/architektur/07` ersetzt den Satz „stellt sich nicht per mDNS vor“.
- Kapitel 8 (Querschnitt Sicherheit) und Kapitel 11 werden ergänzt. Risiko: Multicast in
  Containern.

## Risks / Trade-offs

- **[Eigener TLS-Verifier ist sicherheitskritisch]** → Die Signaturprüfung des Handshakes bleibt
  bei rustls. Tests mit echten rcgen-Zertifikaten über eine lokale TLS-Gegenstelle decken ab:
  passt, passt nicht, Angreifer in der Mitte, Wechsel. Gilt nur für `vor_ort`.
- **[mDNS geht im Container nicht ohne Host-Netz, Router filtern Multicast]** → Die Adresse von
  Hand bleibt immer möglich. `docs/betrieb/packaging.md` nennt `network_mode: host`. Die Liste
  sagt „nichts gefunden“ statt zu schweigen.
- **[Backfill der Ursprungskennung trifft eine weitergereichte Zeile falsch]** → Heute gibt es
  keine weitergereichten Zeilen, weil die Quelle legt an. Der einmalige Neuabgleich bei
  Protokoll 3 berichtigt jede Zeile.
- **[Einmaliger voller Stammdaten-Neuabgleich nach dem Update]** → Paketgröße und Takt wie
  heute. Er läuft im Hintergrund und blockiert keine Anträge (die stehen vorn).
- **[Zwei Instanzen mit gleichem Namen in der Liste]** → Die Liste zeigt immer den
  Fingerabdruck, den die ausstellende Seite beim Code mit anzeigt.
- **[Direktkopplung ohne Führungswechsel]** → Fällt der führende ELW aus, übernimmt der andere
  im LAN nicht. Das ist bewusst so (LLH-1678). Über den Hub geht es wie heute, sobald Netz da
  ist.

## Migration Plan

1. Neue Migration mit einer Nummer größer als jede auf `origin/alpha`
   (`scripts/check-migrationen.sh`, vorher `git fetch`). Inhalt: `instanz_kopplung.art`,
   `instanz_kopplung.tls_zertifikat`, `instanz_kopplungscode.art`,
   `stammdaten_herkunft.ursprung` mit Index und Backfill.
2. Ausrollen: Hub zuerst oder ELW zuerst, beides geht wegen N/N−1. Eine Direktkopplung entsteht
   erst, wenn beide ELW Protokoll 3 sprechen.
3. Rückweg: Die Schalter sind aus, Spalten mit Vorgabe stören ältere Lesepfade nicht. Bestehende
   Direktkopplungen widerruft man an beiden Seiten.

## Nachträge

- **12.11.2026, D3: Fingerabdruck in der DB statt in `AppState`.** Der eigene Fingerabdruck steht
  in `instanz_identitaet.tls_zertifikat` (beim Start gesetzt, ohne `--tls` geleert), wie der
  Schalter `fuehrung_an`. Grund: Melden und Abgleich laufen nur mit dem Pool, und Tests
  betreiben mehrere Instanzen in einem Prozess.
- **12.11.2026, D3: Erkennen beim Einlösen.** Die einlösende Seite weiß vorher nicht, welche Art
  der Code hat. Sie versucht es zuerst mit dem Plattform-Verifier. Lehnt dieser das Zertifikat ab,
  folgt ein zweiter Versuch ohne Kettenprüfung mit `nur_vor_ort`; die ausstellende Seite weist
  dann einen Standardcode mit 409 ab, ohne ihn zu verbrauchen. Abweisungen an eine Gegenstelle mit
  gültigem Code (Art, Protokoll, `nur_vor_ort`) gehen klar hinaus (409/426), nicht als
  einheitliches 401.
- **12.11.2026, D3: Anzeige an der erreichten Seite.** Die Meldung, die einen Zertifikatswechsel
  auslöst, trägt noch den alten Pin; „Zertifikat bestätigt“ zeigt die erreichte Seite ab der
  nächsten Meldung.
- **12.11.2026, Admin-Spur.** Zwei neue Aktionen (`instanz_zertifikat_gewechselt`,
  `instanz_adresse_geaendert`) brauchen den Neubau von `admin_audit` (Migration 0336; sie baut
  auf dem Neubau des Maschinenzugangs von `alpha`, 0334, auf, damit dessen Aktionen und die der
  Archiv-Spur im CHECK bleiben).
- **12.11.2026, D4: eigene reine Funktion statt Parameter.** Die Regel steht als
  `austausch::entscheide_vor_ort(bisher, neu, sender, ich)` neben `entscheide`, nicht als
  zusätzlicher Parameter: Sie gilt vor allen richtungsabhängigen Zweigen und unabhängig von der
  Richtung. Maßgeblich ist, ob der Absender bisher führte (nicht, wer die Epoche vergab); so gilt
  auch eine Notübernahme durch den Hub, die der bisherige Führer bestätigt hat und vor Ort meldet.
- **12.11.2026, D4: Spiegel ohne gekoppelten Führer.** Geht die Führung an eine Instanz, die hier
  nicht gekoppelt ist, löst `spiegel::fuehrung::richte_aus` den Spiegel von der alten Kopplung
  („Abgleich beendet“, „Die führende Instanz ist hier nicht gekoppelt.“). Vorher blieb er an der
  alten Kopplung und fragte dort vergeblich nach. Wird der neue Führer später gekoppelt, hängt
  sich der Spiegel wie bisher an.
- **12.11.2026, D2: Prüfstellen in SQL.** `find_quelle` und `is_org_verteilend` filtern in SQL auf
  `k.art = 'standard'`; der Wächter `instanz::art_tests::jeder_fluss_hat_seine_pruefstellen`
  zählt sie mit.
- **12.11.2026, D5: Übersetzen nur an der Standardkopplung.** `meldend` heißt in Absender,
  Empfänger und Anträgen jetzt „übersetzt über die Herkunft dieser Kopplung“
  (`abgleich::uebersetzt`: meldende Seite einer Standardkopplung). Über eine Direktkopplung
  gehen die Kennungen des Absenders unverändert hinaus, und der Empfänger (`Empfaenger::vor_ort`)
  bildet allein über die Ursprungskennung ab. Auf Standardkopplungen ist sie der letzte Versuch
  vor dem bisherigen Ausgang.
- **12.11.2026, D5: Kataloge unverändert.** Katalogzeilen (`spiegel::katalog`, etwa
  Sprechgruppen des Org-Katalogs) kommen über eine Direktkopplung wie an jeder nicht übersetzenden
  Seite als Kopie; ein Gegenstück über die Ursprungskennung gibt es dort nicht. Grund: Kataloge
  sind Einsatzdaten mit eigenem Abgleich (LLH-1629), keine verteilten Stammdaten.
- **12.11.2026, D5: Eintreffen statt Belegung.** Die einzige Stammdaten-Referenz in Anträgen ist
  die Einheitsvorlage beim Eintreffen im Bereitstellungsraum; das Spec-Szenario ist entsprechend
  berichtigt. Sie ist per Unit-Test (`antrag::tests::ein_eintreffen_nennt_den_ursprung_seiner_einheitsvorlage`)
  und über `nach_ursprung` belegt, nicht mit einem Lauf über drei Instanzen.
- **12.11.2026, D7: Verträglichkeit mit Protokoll 2.** Kein Struct auf der Leitung verbietet
  unbekannte Felder; die neuen sind optional und fehlen leer. Belegt per Unit-Test
  (`spiegel::tests::die_neuen_felder_sind_optional_und_fehlen_leer_auf_der_leitung`); eine
  Gegenseite mit Protokoll 2 lässt sich im selben Binary nicht starten.
- **12.11.2026, D6: Neuauflösen über die Aussage zum Zertifikat.** Eine neu gefundene Adresse
  prüft `melden` mit der signierten Rückfrage `POST /api/instanz/zertifikat` (ohne Nutzdaten),
  nicht mit der Meldung selbst; erst danach gelten Adresse und gegebenenfalls ein neuer Pin, und
  die Meldung geht gleich dorthin. Antwortet dort niemand gültig, bleibt die alte Adresse, und die
  Kopplung zeigt den Fehler der Rückfrage („Antwort ungültig“).
- **12.11.2026, D6: Version und Multicast.** `mdns-sd` ist auf 0.21.6 (19.10.2026) gepinnt;
  0.21.7 war jünger als zwei Wochen. Der Test mit zwei echten Daemons
  (`entdeckung::tests::zwei_daemons_finden_einander`) lief in der Cloud-Sitzung grün, steht aber
  mit `#[ignore]`, weil Multicast in CI-Runnern nicht sicher ist; die Integrationstests nutzen die
  Naht `Sucher`.
- **12.11.2026, D8: eigener Knopf statt Wahl im Dialog.** „Code ausstellen“ bleibt ein Klick; daneben
  steht „Code vor Ort“ (gesperrt mit Grund ohne Passkeys oder ohne `--tls`, Erklärung im
  Tooltip). Die Liste „Im Netz gefunden“ sucht auf Knopfdruck als Mutation, ohne eigenen
  Query-Key: sie ist ein einmaliger Abruf, kein Zustand der Seite.
- **12.11.2026, Migrationen umgelegt.** `alpha` brachte 0329/0330 (Archiv, LLH-1494); die
  Migrationen dieser Change liegen jetzt auf 0335 (Art, Zertifikat), 0336 (Spur) und 0337
  (Ursprung); 0331 bis 0334 brachte `alpha` später noch (Bruchstelle LLH-1657, Hinweise LLH-1495,
  Maschinenzugang LLH-1652 samt eigenem Neubau von `admin_audit`, dessen Aktionen 0336 übernimmt). Der Neubau von
  `admin_audit` übernimmt die Liste aus `alpha` samt der vier Archiv-Aktionen.
