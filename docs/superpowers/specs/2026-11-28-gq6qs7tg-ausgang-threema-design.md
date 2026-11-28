# Ausgang per Threema Gateway an Externe Stellen (LLH-2096)

Zunder: https://zunder.rubeen.dev/#/aufgabe/gq6qs7tgguzqhfg3za8nfigo
(Unteraufgabe von LLH-1197; baut auf LLH-2093 E-Mail, LLH-2095 Fax und LLH-2094 Matrix, Design-Docs
`docs/superpowers/specs/2026-11-24-w1ymakq6-ausgang-email-design.md`,
`docs/superpowers/specs/2026-11-25-atnsssv3-ausgang-fax-pdf-design.md`,
`docs/superpowers/specs/2026-11-25-ntaizave-ausgang-matrix-design.md`)

Stand: 28.11.2026, Entwurf. Abgestimmt am Phase-1-Checkpoint (27.11.2026, „passt“ zu allen
Empfehlungen): nur E2E-Modus; privater Schlüssel vom Admin eingefügt; öffentlicher Schlüssel des
Empfängers beim ersten Versand gemerkt; Text (bei Bedarf geteilt) plus PNG-Anlagen als
Dateinachricht, kein PDF; Abbruch beim Senden ist `ungewiss`; Vorbelegung Matrix vor Threema vor
Mail; Endstand `uebergeben`.

## Absicht

Der Ausgangskorb stellt heute E-Mail, Fax und Matrix zu: Ein Mensch löst aus, der Server stellt
zu, jeder Versand steht im ETB (ADR-0104). Threema ist bei Behörden, Feuerwehren und
Hilfsorganisationen verbreitet, oft als dienstlich freigegebener Messenger (Threema Work), und
viele Ansprechpartner lesen dort schneller als im Postfach. Threema Gateway ist der offizielle Weg,
aus einer Anwendung an Threema-IDs zu senden. Im **E2E-Modus** verschlüsselt der Absender selbst;
Threema transportiert nur und kann den Inhalt nicht lesen.

Ein Lagebericht, ein Befehl oder eine Nachforderung landet damit als Threema-Nachricht beim
Ansprechpartner der Stelle, mit den PNG-Anlagen als Bilder.

## Ziele

1. Eine Externe Stelle kann **Threema-IDs** als Kanaladresse tragen (acht Zeichen, etwa
   `ECHOECHO`), neben Mail, Matrix und Fax.
2. Eine Organisation richtet ein **Threema-Gateway-Konto** als Anbindung ein (Art „Threema
   Gateway“: Gateway-ID, API-Secret, privater Schlüssel), mit „Verbindung prüfen“, das auch das
   verbleibende Guthaben zeigt.
3. Der **Senden-Dialog** zeigt Threema-IDs neben den übrigen Adressen; der Ausgangskorb stellt
   über den Threema-Zusteller zu.
4. Jede Nachricht geht **Ende-zu-Ende verschlüsselt** hinaus (NaCl `crypto_box`), auch die
   Anlagen (verschlüsselte Blobs).
5. Wiederholung, Versandliste, ETB, „Erneut senden“, Spiegel, Schwärzung und Überholt-Prüfung
   gelten unverändert wie bei den anderen Kanälen.

## Nicht-Ziele

- **Basis-Modus** (Threema verschlüsselt am Server und sieht den Inhalt): bewusst nicht
  angeboten.
- Telefonnummer oder E-Mail-Adresse als Threema-Adresse (Nachschlagen über `lookup/phone`,
  `lookup/email`); später möglich.
- Gruppenchats.
- **Empfangen**: Antworten, Empfangsbestätigungen und Lesebestätigungen. Sie bräuchten eine
  öffentlich erreichbare Callback-URL des Hubs; das wird ein eigener Nachzug (Zunder-Aufgabe).
  Der Endstand eines Threema-Versands ist deshalb `uebergeben`, nie `zugestellt`.
- Prüfung der Fähigkeiten des Empfängers (`capabilities`): Alle aktuellen Threema-Apps nehmen
  Dateinachrichten an.
- PDF: Ein Telefon liest den Text direkt; das PDF bleibt bei E-Mail und Fax (ADR-0110).
- Ein vom Hub erzeugtes Schlüsselpaar: Der Admin bringt den privaten Schlüssel seiner bestehenden
  Gateway-ID mit.
- Threema-Versand vom gekoppelten ELW (wie bei den anderen Kanälen: Geheimnisse fließen dort
  nicht hin).

## Anti-Ziele

- Ein Inhalt geht **unverschlüsselt** an Threema, auch nicht als Rückfall.
- Ein Versand verschlüsselt still für einen **anderen öffentlichen Schlüssel** als den, der für die
  ID gemerkt ist (untergeschobener Schlüssel).
- Eine Nachricht erscheint **doppelt** beim Empfänger, weil der Lauf selbst wiederholt hat,
  nachdem die Anfrage schon hinaus war.
- API-Secret, privater Schlüssel, Inhalt oder Antworttext von Threema stehen in Log, Fehlertext,
  Antwort, ETB oder Admin-Spur.
- Der Server verbindet sich mit einem anderen Ziel als dem festen Gateway-Host, oder folgt einer
  Weiterleitung.

## Ansätze

**Gewählt: eigener schlanker Client über unseren `reqwest`-Client, Verschlüsselung mit
`crypto_box` und `crypto_secretbox` (RustCrypto, MIT/Apache, reines Rust).** Das ist dasselbe
Muster wie bei sipgate (`adapter::sipgate`): feste Basis-URL, Zielschutz, keine Weiterleitung,
gedeckelte Antworten. Die API ist klein: fünf Aufrufe (siehe Abschnitt 3).

Verworfen:
- **Crate `threema-gateway`.** Bringt eigenen HTTP-Client und eigene Fehlertypen mit. Unseren
  Zielschutz (`ausgehend::client_builder`, Resolver) einzuhängen ginge nur über Umwege, und
  die Fehlerzuordnung (vor dem Senden oder danach abgebrochen) wäre nicht in unserer Hand.
- **Basis-Modus zusätzlich.** Einfacher, weil Threema verschlüsselt, aber Threema läse mit; das
  widerspricht dem Zweck (Checkpoint).
- **Vom Hub erzeugtes Schlüsselpaar.** Der private Schlüssel verließe den Server nie, aber die
  Einrichtung bräuchte zwei Schritte (Schlüssel erzeugen, bei Threema registrieren, ID eintragen),
  und eine bestehende Gateway-ID ließe sich nicht übernehmen (Checkpoint).
- **Öffentlichen Schlüssel jedes Mal neu abfragen.** Keine eigene Tabelle, aber ein
  kompromittierter Verzeichnisdienst könnte einen fremden Schlüssel unterschieben, ohne dass es
  jemand merkt. Eine Threema-ID behält ihr Schlüsselpaar dauerhaft; Merken kostet fast nichts
  (Checkpoint).

## Entwurf

### 1. Kanal `threema` freischalten

- `KanalArt::Threema.is_freigeschaltet()` wird `true`, `KanalArt::adapter_art` liefert
  `threema` (`src/externe_stelle/mod.rs`). Tabelle und CHECK kennen `threema` seit 0382 bzw.
  0383; es braucht dafür keine Migration.
- **Adresse prüfen** (`externe_stelle::kanal::normalize_threema`): getrimmt, Leerraum innen
  entfernt (`ECHO ECHO` ist ein üblicher Tippstil), in Großbuchstaben; genau acht Zeichen aus
  `A–Z` und `0–9`, wobei das erste Zeichen auch `*` sein darf (Gateway-IDs). Fehlertext:
  „Eine Threema-ID hat acht Zeichen (Buchstaben und Ziffern)“. Ob es die ID gibt, prüft erst der
  Versand.
- Oberfläche der Stelle (`ExterneStelleKanaele.tsx`): „Adresse hinzufügen“ bekommt die Wahl
  Threema-ID; `KANAL_TEXT` bekommt einen eigenen Eintrag für Threema (der Sonderfall „spricht wie
  die E-Mail“ fällt). Die Liste der Stellen zählt „1 Threema“ (gibt es schon).

### 2. Anbindung „Threema Gateway“ (Adapter-Art `threema`)

- **Felder:** `gateway_id` (Pflicht, `*` plus sieben Zeichen `A–Z0–9`, in Großbuchstaben
  gebracht).
- **Plätze (Geheimnisse):** `secret` (API-Secret, Pflicht) und `privater_schluessel` (Pflicht:
  64 Hex-Zeichen, wahlweise mit dem Präfix `private:` aus dem Werkzeug von Threema; gespeichert
  ohne Präfix, in Kleinbuchstaben). Ein ungültiger Schlüssel wird beim Speichern mit 422
  abgelehnt. Er wird nie angezeigt.
- Kein URL-Feld: Die Basis-URL ist fest (`https://msgapi.threema.ch`), wie bei sipgate. Die Art
  erklärt kein `http_im_lan`.
- Höchstens **eine Threema-Anbindung je Org**, gezählt wie bei SMTP, Fax und Matrix (422 bei
  einer zweiten).
- **Lauf = Verbindungsprüfung** (Intervall Minimum 15 min, Vorschlag 60 min, `OhneUebernahme`,
  wie Matrix):
  1. `GET /credits` mit `from` und `secret`: 401 → `abgelehnt`; sonst das Guthaben lesen.
  2. `GET /pubkeys/{gateway_id}`: Der öffentliche Schlüssel, den Threema für die eigene ID kennt,
     muss zum privaten Schlüssel der Anbindung passen (aus ihm abgeleitet). Passt er nicht →
     `schluessel_passen_nicht` (den Code gibt es seit Matrix). Text für Threema: „Der private
     Schlüssel gehört nicht zu dieser Gateway-ID.“
  3. Das Guthaben merkt die Anbindung als Angabe der Prüfung und zeigt es an („Guthaben:
     1 234 Credits“). Bei 0 zeigt sie einen Hinweis (kein Fehler, kein Störungszustand), weil
     dann jeder Versand scheitert.
- Fehler sonst nach den bestehenden `AdapterFehler` (Netz, DNS, TLS, Zeit, Zielschutz, Status).

### 3. Der Client (`adapter::threema`)

Fünf Aufrufe gegen `https://msgapi.threema.ch`, alle mit `from` (Gateway-ID) und `secret`:

| Aufruf | Zweck |
|---|---|
| `GET /credits` | Prüfung: Zugang gültig, Guthaben |
| `GET /pubkeys/{id}` | öffentlicher Schlüssel einer ID (eigene bei der Prüfung, Empfänger beim Versand) |
| `POST /upload_blob` (multipart, Feld `blob`) | verschlüsselte Anlage hochladen, liefert Blob-ID |
| `POST /send_e2e` (Formular: `to`, `nonce`, `box`) | verschlüsselte Nachricht senden, liefert Nachrichten-ID |

- Gebaut über `ausgehend::client_builder(Zweck::Anbindung)` mit dem Resolver des Zielschutzes
  (wie `adapter::sipgate`), ohne Weiterleitungen. Zeitlimits: Abfrage 20 s, Senden 30 s, Upload
  120 s. Antworten auf 64 KiB gedeckelt.
- `secret` und Inhalt gehen im Body (Formular), nicht in der URL, wo die API das erlaubt; bei
  `GET` stehen `from` und `secret` in der Query. Deshalb loggt der Client nie eine URL (wie
  sipgate: nie Token, Inhalt oder Antworttext in Log oder Fehler).
- **Fehlertyp** `ThreemaFehler` nach dem Muster `SipgateFehler`: `Status(u16)`, `Verbindung`
  (vor dem Senden), `Dns`, `Tls`, `ZielIntern`, `Ungewiss` (abgebrochen, nachdem die Anfrage
  hinaus war), `Antwort` (2xx, aber nicht lesbar), `SchluesselPassenNicht`.
- Statuscodes nach der Gateway-Doku: 400 (ID ungültig oder unbekannt), 401 (Gateway-ID oder
  Secret falsch), 402 (kein Guthaben), 404 (ID unbekannt, bei `pubkeys`), 413 (zu lang bzw. Blob
  zu groß), 429 (zu viele Anfragen), 5xx. Der erste Plan-Schritt gleicht Aufrufe, Felder und Codes
  mit der aktuellen Doku ab (https://gateway.threema.ch/de/developer/api).

### 4. Verschlüsselung (`adapter::threema::krypto`)

- **Nachricht:** Klartext = Typbyte + Nutzlast + Padding. Padding nach PKCS#7 mit zufälliger
  Länge 1–255 Bytes, aufgefüllt so, dass Nutzlast plus Padding mindestens 32 Bytes lang ist (gegen
  Längenrückschlüsse bei kurzen Texten). Verschlüsselt mit `crypto_box` (X25519, XSalsa20-Poly1305)
  aus dem privaten Schlüssel der Anbindung und dem öffentlichen Schlüssel des Empfängers, Nonce
  24 Bytes zufällig je Nachricht.
- **Text:** Typ `0x01`, UTF-8, höchstens **3500 Bytes** je Nachricht.
- **Datei:** Typ `0x17`, Nutzlast JSON `{"b": blob-id, "k": schlüssel-hex, "m": "image/png",
  "n": "anlage-{n}.png", "s": größe, "j": 1}` (`j: 1` = als Bild anzeigen). Der Blob ist die PNG,
  verschlüsselt mit `crypto_secretbox` unter einem zufälligen 32-Byte-Schlüssel je Datei und der
  festen Nonce `0x00…01`, wie es das Protokoll für Dateiblobs vorschreibt. Kein Vorschaubild (das
  Feld `t` ist optional); ob die Apps ohne Vorschaubild sauber anzeigen, prüft die Handprobe.
- Zufall aus `OsRng`. Schlüsselmaterial liegt nur im Speicher und wird nach Gebrauch genullt, wo
  die Typen es anbieten (`zeroize`).
- Keine eigene Kryptografie über die Bibliotheksaufrufe hinaus. Ein Test entschlüsselt mit dem
  Gegenschlüssel und prüft Typbyte, Nutzlast und Padding; ein zweiter prüft gegen einen festen
  Testvektor aus der Threema-SDK-Doku, falls sie einen nennt (sonst gegen einen selbst
  erzeugten, festgeschriebenen Vektor).

### 5. Öffentliche Schlüssel merken (Migration `0392_threema_schluessel`)

- Neue Tabelle `org_threema_schluessel` (`org_id` FK, `threema_id` TEXT, `public_key` TEXT
  64 Hex, `gemerkt_at`; PK `(org_id, threema_id)`).
- **Beim Versand:** Gibt es keinen Eintrag, holt der Zusteller den Schlüssel über `pubkeys`, und
  der Lauf merkt ihn in derselben Transaktion wie das Ergebnis des Versuchs. Gibt es einen, holt
  der Zusteller den Schlüssel trotzdem und vergleicht. **Weicht er ab, scheitert der Versand
  dauerhaft** mit `verschluesselung` und dem ETB-Grund „Der Schlüssel der Threema-ID hat sich
  geändert“. Der gemerkte Schlüssel wird dabei nie überschrieben. *(Eigene Wahl: kein neuer
  Fehlercode, weil der CHECK auf `ausgang.fehler_art` sonst einen Tabellenumbau bräuchte;
  `verschluesselung` trifft es aus Bediensicht: „Verschlüsseln nicht möglich“.)*
- **Zurücksetzen** ist in diesem Schnitt nicht vorgesehen. Eine Threema-ID behält ihr
  Schlüsselpaar dauerhaft; ändert er sich doch, ist das ein Fall für den Support von Threema und
  für eine neue ID an der Stelle. *(Eigene Wahl.)* Ein Eintrag bleibt, auch wenn die Adresse an
  der Stelle entfernt wird.
- Die Tabelle wird **nicht gespiegelt** (`instanz::spiegel::art::AUSGENOMMEN`, wie `ausgang`); sie
  trägt keine personenbezogenen Daten über die ID hinaus, die schon an der Stelle steht, und fällt
  deshalb nicht unter Schwärzung und Aufbewahrung. Org-Isolation wie jede `org_*`-Tabelle.
- Der Zusteller hält keine Datenbankverbindung: Der Lauf liest den gemerkten Schlüssel vor dem
  Zustellen und gibt ihn im `Versandauftrag` mit (neues optionales Feld). Der Zusteller meldet in
  `Zustellt` bzw. `Fehlschlag` den abgefragten Schlüssel zurück, wenn noch keiner gemerkt war.

### 6. Zustellen im Ausgangskorb

- **`ThreemaZusteller`** setzt den bestehenden Trait `Zusteller` um und kommt in die
  `Zustellerwahl` (`KanalArt::Threema => self.threema`). Einen eigenen Weg wie das Fax braucht es
  nicht: Threema bestätigt nur die Annahme, und ohne Callback gibt es keinen späteren Stand.
  `Zustellwege::mail` heißt danach weiter so (Grenzwert im Code, kein Umbau in diesem Schnitt).
- **Zugang:** `zugang_fuer_versand` und `pruefe_versand_moeglich` finden die Anbindung über
  `KanalArt::adapter_art` (`threema`); fehlt sie, ist es 422 `anbindung_fehlt`, wie heute.
  `routes/ausgang.rs` nimmt `threema` an (der Sonderfall „Threema nimmt noch kein Versand an“
  fällt).
- **Teile:** Aus dem Schnappschuss entsteht eine feste Folge von Teilen. Zuerst die Textteile,
  dann je PNG-Anlage ein Dateiteil. Nummeriert wird fortlaufend ab 0 (Text 0…k−1, Anlagen
  k…k+n−1). Weil der Schnappschuss unveränderlich ist, ergibt jeder Versuch dieselbe Folge. Der
  Zusteller lässt gemerkte Teile (`ausgang_teil`) aus und meldet jeden gesendeten Teil mit der
  Nachrichten-ID von Threema (Spalte `event_id`).
- **Text teilen:** Der Text ist wie bei Matrix erste Zeile Betreff, dann Inhalt, dann der Fuß
  („Gesendet mit Lifeline Hub“, Einsatz, absendende Person, Uhrzeit), aber als Klartext ohne
  Markdown-Maskierung (Threema zeigt `*fett*`; der Betreff steht als `*Betreff*`; Sternchen im
  Inhalt werden nicht maskiert, Threema kennt kein Escape). Passt er nicht in 3500 Bytes, wird er
  an Absatzgrenzen geteilt, notfalls an Zeilen-, zuletzt an Zeichengrenzen (nie mitten in einem
  UTF-8-Zeichen). Jeder Teil beginnt mit „(i/k)“; der Fuß steht nur im letzten Teil.
- **Ablauf je Versand** (ohne DB-Verbindung):
  1. Öffentlichen Schlüssel des Empfängers holen und mit dem gemerkten vergleichen (Abschnitt 5).
  2. Je fehlendem Teil: Text verschlüsseln und senden; Datei verschlüsseln, hochladen, dann die
     Dateinachricht verschlüsseln und senden.
  3. Ergebnis mit den gesendeten Teilen zurück.
- **Fehlerzuordnung** (`Zustellfehler`):

  | Lage | Zustellfehler | ETB-Grund (fest, deutsch) |
  |---|---|---|
  | Verbindung, DNS, Zeit vor dem Senden; 429; 5xx; Abbruch beim Upload | `Voruebergehend` | „Threema nicht erreichbar“ bzw. „Zu viele Anfragen an Threema“ |
  | Abbruch nach dem Absenden von `send_e2e` | `Ungewiss` | „Ob Threema die Nachricht angenommen hat, ist unklar“ |
  | 401 | `Anbindung { pruefung_vorziehen: true }` | „Threema lehnt die Anmeldung ab“ |
  | 402 | `Anbindung { pruefung_vorziehen: true }` | „Kein Guthaben im Threema-Gateway“ |
  | 400 oder 404 bei `pubkeys` bzw. `send_e2e` | `Abgelehnt` | „Threema-ID unbekannt“ |
  | 413 | `ZuGross` | „Für Threema zu groß“ |
  | Schlüssel weicht ab; Verschlüsseln scheitert | `Verschluesselung` | „Der Schlüssel der Threema-ID hat sich geändert“ bzw. „Verschlüsseln nicht möglich“ |

  Ein Abbruch nach dem Absenden ist `ungewiss`, wie bei SMTP nach DATA und anders als bei Matrix:
  Threema kennt keine Transaktions-ID, ein automatischer neuer Versuch könnte doppelt senden.
  „Erneut senden“ schickt nur die nicht gemerkten Teile; der Teil, bei dem abgebrochen wurde, kann
  dabei doppelt ankommen, und das sagt der Hinweis an `ungewiss` (gibt es schon). Die
  Neustart-Regel (`versuch_begonnen_at` → `ungewiss`) gilt unverändert. `smtp_status` bleibt leer.
- **Größe:** Anlagen höchstens 50 MB je Blob (Grenze des Gateways); die 20-MiB-Summe des
  E-Mail-Schnitts gilt weiter und liegt darunter.
- **Kosten:** Jede Nachricht kostet Credits (Text und Datei je eine Nachricht, der Upload nicht
  zusätzlich, laut Preisliste prüfen). Die Versandliste zeigt die Zahl der Nachrichten nicht; die
  Anwenderdoku nennt, dass ein langer Lagebericht mit Anlagen mehrere Nachrichten kostet.

### 7. Oberfläche

- **Senden-Dialog** (`SendenDialog.tsx`): Threema-IDs erscheinen in der Liste je Stelle, Kanal
  als kleines Zeichen davor (`kanalAnzeige.ts`, gibt es schon). Vorbelegt wird je Stelle die
  erste Matrix-Adresse, sonst die erste Threema-ID, sonst die erste Mailadresse; Fax wird nie
  vorbelegt. Gesperrt mit Grund je Kanal („Kein Threema-Gateway eingerichtet“).
- **Versandliste:** Threema-Zeile zeigt die ID; der Endstand ist `uebergeben` („an Threema
  übergeben“).
- **Anbindungen:** Art „Threema Gateway“ im bestehenden Paneel: Felder Gateway-ID, Secret,
  privater Schlüssel; nach der Prüfung Guthaben und, bei 0, der Hinweis. (Die Abruf-Angaben, die
  für Versand-Anbindungen nicht passen, behebt LLH-2126 für alle Versandarten.)
- Texte nach `frontend/AGENTS.md`.

### 8. Regel, Entscheidung, Doku

- **ADR-0112** (neu, präzisiert ADR-0104, `vorgeschlagen`): Threema ist ein Kanal des
  Ausgangskorbs, nur im E2E-Modus, mit gemerktem Empfängerschlüssel; ein abweichender Schlüssel
  bricht den Versand ab, nie wird er still übernommen. Nummer beim Schreiben über
  `scripts/adr-fuer.sh` bzw. die nächste freie prüfen (`docs/architektur/AGENTS.md`).
- **`src/AGENTS.md`, „Ausgang an Menschen“:** Threema in die Kanalliste (`threema` → `threema`),
  Client nur über `adapter::threema` mit festem Host und Zielschutz, nie Basis-Modus, nie Klartext,
  Empfängerschlüssel gemerkt und nie überschrieben, Abbruch nach dem Absenden `ungewiss`.
- `docs/architektur`: Bausteinsicht (`adapter::threema`), Laufzeitsicht „Versand“ um Threema
  ergänzen, Querschnitt Ausgang.
- `docs/anwender`: Anbindungen (Threema Gateway einrichten: E2E-ID bei Threema beantragen,
  Schlüsselpaar mit dem Werkzeug von Threema erzeugen, Gateway-ID, Secret und privaten Schlüssel
  eintragen, Guthaben), Stammdaten (Threema-ID eintragen), Senden (Kosten, kein „zugestellt“).
- Lizenzen und Advisories nach `scripts/AGENTS.md` für `crypto_box`, `crypto_secretbox`.

## Testbarkeit

- **Krypto:** Verschlüsseln und mit dem Gegenschlüssel entschlüsseln (Text und Datei); Padding
  1–255 und Mindestlänge 32; Testvektor festgeschrieben; Blob mit fester Nonce entschlüsselbar.
- **Client gegen einen nachgebauten Gateway** (`wiremock`, wie bei sipgate): `credits`,
  `pubkeys`, `upload_blob`, `send_e2e`; jeder Statuscode aus Abschnitt 3; Abbruch vor und nach dem
  Absenden; nie das Secret in einem Fehlertext.
- **Zusteller:** Teilfolge (Text geteilt an Absätzen, UTF-8-Grenzen, „(i/k)“, Fuß nur am Ende);
  gemerkte Teile werden ausgelassen; Schlüssel neu → zurückgemeldet; Schlüssel abweichend →
  `verschluesselung`, nichts gesendet.
- **Lauf:** Fehlerzuordnung aus der Tabelle; Schlüssel wird in derselben Transaktion gemerkt;
  `ungewiss` wird nie selbst wiederholt; Org-Isolation der Schlüsseltabelle.
- **Adresse:** acht Zeichen, Kleinschreibung, Leerraum innen, `*`, sieben oder neun Zeichen,
  Sonderzeichen.
- **Anbindung:** Prüfung mit passendem und unpassendem privatem Schlüssel, 401, Guthaben 0
  (Hinweis), zweite Anbindung je Org 422, ungültiger Schlüssel beim Speichern 422.
- **e2e:** Threema-ID an einer Stelle eintragen, Senden, Versandliste „übergeben“ (Testdoppel).
- **Handprobe** mit einer echten Gateway-ID an ein Telefon: Text, geteilter Text, Bild. Sie gehört
  in die PR-Beschreibung, wenn ein Zugang zur Verfügung steht; sonst steht dort, dass sie fehlt.

## Dem Builder überlassen

- Modulschnitt (`adapter::threema`, `adapter::threema_art`, `ausgang::zusteller::threema`),
  Funktionsnamen.
- Wie der gemerkte Schlüssel durch `Versandauftrag`, `Zustellt` und `Fehlschlag` läuft, solange
  der Zusteller keine Datenbankverbindung hält.
- Wortlaut der Texte und Hinweise.
- Ob das Guthaben als Einstellung der Prüfung oder als eigenes Feld des Zustands der Anbindung
  gemerkt wird.
