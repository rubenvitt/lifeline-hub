# Webhooks: Zertifikats-Pinning (LLH-1872) — Design

Zunder: https://zunder.rubeen.dev/#/aufgabe/wx6bfsmc6sxzws6cnlcr7589 · Route `entwurf` (E1, E3) ·
abgestimmt mit Ruben am 22.11.2026 (Phase-1-Checkpoint).

## Absicht

Ein Webhook an ein Fremdsystem im ELW-Netz scheitert heute mit Fehlerart `tls`, weil das Ziel ein
selbstsigniertes Zertifikat zeigt und der Webhook-Client nur den Vertrauensankern des Systems
glaubt (ADR-0046, Konsequenzen). Der Admin soll am Webhook den Fingerabdruck des Zertifikats
hinterlegen können; dann zählt genau dieses Zertifikat, wie bei der Direktkopplung (ADR-0029).

## Ziele

- Am Webhook optional einen **SHA-256-Fingerabdruck des Zertifikats** (DER, wie
  `instanz::identitaet::tls_fingerabdruck`) hinterlegen, ändern und entfernen.
- Mit Pin gilt **nur der Pin**: weder Kette noch Hostname noch Vertrauensanker. Ein Ziel mit
  anderem Zertifikat scheitert mit `tls`, auch wenn eine vertraute Stelle es ausgestellt hat.
- Ohne Pin bleibt alles wie heute (Vertrauensanker des Systems).
- Den Fingerabdruck **vom Ziel abrufen** können, ohne dass Nutzdaten oder eine HTTP-Anfrage
  hinausgehen; übernommen wird er erst, wenn der Admin ihn bestätigt und speichert.
- Admin-Spur für Setzen, Wechseln und Entfernen; Anzeige des Fingerabdrucks in der Ansicht.
- Der TLS-Teil ist so geschnitten, dass der Adapter-Rahmen (`adapter::ziel`) ihn später ohne
  Umbau übernehmen kann.

## Nicht-Ziele

- Die Adapter auf Pins umstellen (eigene Aufgabe, wenn gebraucht).
- Pin des öffentlichen Schlüssels (SPKI); verworfen, s. „Ansätze“.
- Mehrere Pins je Webhook (Übergang bei Zertifikatswechsel). Ein Wechsel heißt: neu abrufen,
  vergleichen, speichern.
- Den bei einer Abweichung gesehenen Fingerabdruck im Verlauf speichern.
- Inhalt des Zertifikats (Aussteller, Ablauf, Name) auslesen und zeigen.

## Anti-Ziele (wäre ein Fehlschlag, auch wenn es läuft)

- Ein gepinnter Webhook umgeht den Zielschutz: Resolver, `no_proxy`, keine Weiterleitung,
  `https_only` und `check_url` gelten mit und ohne Pin unverändert (ADR-0046).
- Das Abrufen schickt eine HTTP-Anfrage oder Nutzdaten an ein ungeprüftes Zertifikat.
- Ein abgerufener Fingerabdruck wird ohne Zutun des Admins gespeichert (Trust on first use).
- Ein neuer Fehlercode, der vom Akzeptanzkriterium (`tls`) abweicht.

## Ansätze

**Was gepinnt wird**
- *Zertifikat-SHA-256 (gewählt).* Derselbe Wert wie bei der Direktkopplung und wie ihn
  `openssl x509 -fingerprint -sha256` oder ein Browser zeigt; am Zielgerät leicht abzulesen.
  Nach einem Zertifikatswechsel muss neu gepinnt werden.
- *Öffentlicher Schlüssel (SPKI), verworfen.* Überlebt eine Erneuerung mit gleichem Schlüssel,
  aber selbstsignierte ELW-Zertifikate wechseln den Schlüssel meist mit, und Geräte zeigen den
  Wert selten an.

**Geltung**
- *An jedem Webhook (gewählt).* Keine Kopplung an die LAN-Ausnahme, kein Nebeneffekt beim
  Entziehen der Ausnahme; auch ein öffentliches Ziel lässt sich härten. Die Oberfläche warnt, dass
  nach einer Zertifikatserneuerung neu gepinnt werden muss.
- *Nur mit LAN-Ausnahme, verworfen.* Ein Feld weniger im Normalfall, dafür eine Regel mehr
  (Entziehen der Ausnahme entfernt den Pin).

**Wie der Pin hineinkommt**
- *Eintippen und vom Ziel abrufen (gewählt).* Der Abruf liest das Zertifikat im TLS-Handshake und
  bricht ihn dann ab; der Admin vergleicht mit dem Gerät und speichert.
- *Nur eintippen, verworfen.* Kleiner, aber 64 Hex-Zeichen in der Lage abzutippen ist
  fehleranfällig.

**Fehlerart bei Abweichung**
- *`tls` (gewählt)*, wie im Akzeptanzkriterium; die Oberfläche formuliert den Text anders, wenn
  ein Pin gesetzt ist. *Eigener Code `zertifikat_passt_nicht`, verworfen:* neuer Wire-Wert ohne
  echten Mehrwert für den Empfänger der Diagnose.

## Entscheidungen

### D1 Datenmodell

- Neue Spalte `maschine_webhook.zertifikat_pin TEXT NULL`, gespeichert als 64 Zeichen
  Kleinbuchstaben-Hex (CHECK auf Länge und Zeichen). `NULL` = kein Pin.
- `repo::Webhook`, `SPALTEN`, `repo::Eingabe` tragen `zertifikat_pin: Option<String>`.
- Ein geänderter Pin (gesetzt, gewechselt, entfernt) zählt in `repo::update` wie ein neues Ziel
  (`ziel_neu`): die Störung eines aktiven Webhooks wird zurückgesetzt, ein laufender Versuch mit
  dem alten Stand landet wegen des CAS-Stands `geaendert_at` nur im Verlauf.
- Admin-Spur: neue Aktionen `maschinenzugang_webhook_pin_gesetzt` (beim Anlegen mit Pin, beim
  Setzen und beim Wechsel), `maschinenzugang_webhook_pin_entfernt` und
  `maschinenzugang_webhook_zertifikat_abgerufen` (D4). Angaben: `host` wie bisher,
  `fingerabdruck` (neu bzw. abgerufen) und beim Wechsel/Entfernen `fingerabdruck_vorher`. Die
  Felder gibt es in `ZugangsAngaben` schon. Der aktion-CHECK von `admin_audit` braucht einen
  Tabellenumbau nach Muster der letzten Umbau-Migration (`migrations/AGENTS.md`).
- **Neuer Server, Pin muss neu** (Entscheidung Ruben 22.11.2026): Bleibt der Host der URL gleich
  (nur Pfad, Query oder Port ändern sich), bleibt der Pin. Ändert ein PATCH den Host eines
  Webhooks mit Pin und sagt nichts zu `zertifikat_pin`, antwortet der Server mit 400
  („Neues Ziel: Fingerabdruck neu holen oder entfernen.“). Die Oberfläche leert das Feld, sobald
  sich der Host in der eingegebenen URL ändert, und schickt damit `null` oder einen neuen Pin mit.
  Kein stilles Entfernen.
- Beides in **einer** neuen Migration mit der nächsten freien Nummer.

### D2 Eingabe und Prüfung des Pins

- Eine reine Funktion normalisiert die Eingabe: Doppelpunkte, Leerzeichen und Bindestriche
  entfernen, Kleinbuchstaben; gültig sind genau 64 Hex-Zeichen, sonst 400
  `zertifikat_pin: …` mit verständlichem Text. Ein leerer Wert gilt als „kein Pin“.
- API:
  - `WebhookEingabe` (POST) bekommt `zertifikat_pin: Option<String>`.
  - `WebhookAenderung` (PATCH) bekommt `zertifikat_pin` als dreiwertiges Feld: fehlt = unverändert,
    `null` = entfernen, Text = setzen (Muster `Option<Option<_>>` wie in `routes/abloesung.rs`).
  - `WebhookAnzeige` bekommt `zertifikat_pin: Option<String>`; jeder sieht ihn, der die Anbindung
    sieht: er ist nicht geheim.
- Typ-Codegen nach der DTO-Änderung (`scripts/check-typ-codegen.sh`, beide Dateien mitcommitten).

### D3 TLS mit Pin im Webhook-Client

- In `instanz::zertifikat` eine öffentliche Funktion `tls_config(erwartet: Option<String>) ->
  Result<rustls::ClientConfig, String>` herauslösen, die `build_client` schon heute baut
  (Provider, sichere Protokollversionen, `Verifier`, ohne Client-Auth). `build_client` nutzt sie
  weiter; Webhook (und später Adapter) nutzen sie auch. Kein zweiter Verifier.
- `webhook::ziel::client(lan_erlaubt, pin: Option<&str>)`: ohne Pin die zwei Singletons wie heute;
  mit Pin ein Client je `(lan_erlaubt, pin)` aus einem begrenzten Cache (Muster
  `zertifikat::client`, bei 64 Einträgen leeren). Der Client mit Pin entsteht aus **demselben**
  `baue_client` mit allen Schutzeinstellungen plus `.tls_backend_preconfigured(tls_config(pin))`;
  die ADR-Prüfungen von ADR-0046 bleiben grün.
- `Zustellung` bekommt `zertifikat_pin: Option<String>`; `lauf` und `testereignis` geben den Pin
  des Webhooks mit.
- Abweichung: der `Verifier` liefert `rustls::Error::General(PASST_NICHT)`; `fehler_art` ordnet
  jeden `rustls::Error` schon als `Tls` ein. Ein Test hält das fest.

### D4 Fingerabdruck vom Ziel abrufen

- Route `POST /api/admin/anbindungen/{id}/webhook/zertifikat-abrufen`, nur System-Admin, eigene
  Org, Zugang nicht widerrufen (wie `zugang_fuer_schreiben`). Body `{ url, lan_erlaubt }`, damit
  der Abruf im Einrichten-Dialog vor dem Anlegen und beim Bearbeiten mit geänderter URL
  funktioniert. Die URL besteht `check_url` wie beim Speichern (400 sonst).
- Ablauf: ein einmaliger Client (nicht gecacht) mit allen Schutzeinstellungen des Webhook-Clients
  und einem **erfassenden Verifier**: Er merkt sich den Fingerabdruck des Endzertifikats und
  lehnt den Handshake dann ab. So geht nie ein HTTP-Byte hinaus. Danach liegt der Fingerabdruck
  vor, der Fehler des Requests wird verworfen.
- Antwort 200: `{ fingerabdruck?: string, fehler_art?: WebhookFehler }`; kam es nicht bis zum
  Zertifikat (DNS, Ziel intern, Verbindung, Zeitüberschreitung), steht nur `fehler_art` da.
- **Eintrag in der Admin-Spur** `maschinenzugang_webhook_zertifikat_abgerufen` mit Host und, falls
  erhalten, Fingerabdruck. Anders als das Testereignis nimmt der Abruf eine beliebige URL samt
  LAN-Ausnahme aus dem Body; ohne Eintrag wäre er ein ungeloggter Weg, Hosts und Ports im LAN
  abzutasten (eigene Entscheidung nach dem Builder-Check). Zeitlimits wie die Zustellung.
- Der erfassende Verifier liegt neben `Verifier` in `instanz::zertifikat`, damit er für Adapter
  wiederverwendbar ist.

### D5 Oberfläche (`AnbindungWebhook.tsx`)

- Neues Feld **„Zertifikat“** im Einrichten-Dialog und im Paneel, unter „Lokales Netz“:
  - Anzeige: Fingerabdruck in Gruppen (`AB:CD:…`, Monoschrift) oder „kein Fingerabdruck – es
    gelten die Vertrauensanker des Servers“.
  - Eingabe: Textfeld (Monoschrift, Einfügen mit oder ohne Doppelpunkte) und Knopf
    **„Vom Ziel holen“**. Der Knopf ruft D4 mit der aktuell eingetragenen URL und LAN-Ausnahme,
    zeigt in einem Bestätigungsdialog „Das Ziel zeigt dieses Zertifikat: …. Vergleiche den
    Fingerabdruck mit dem am Zielgerät.“ und trägt ihn erst mit „Übernehmen“ ins Feld ein.
    Gespeichert wird wie jedes Feld mit „Speichern“. Ein Fehler zeigt den Text der Fehlerart.
  - Hinweis unter dem Feld: „Mit Fingerabdruck zählt nur dieses Zertifikat. Wechselt das Ziel sein
    Zertifikat, muss der Fingerabdruck neu hinterlegt werden.“
- `LAN_WARNUNG` endet statt „Das Ziel braucht ein Zertifikat, dem dieser Server vertraut.“ mit
  „… dem dieser Server vertraut, oder einen hinterlegten Fingerabdruck.“
- `webhookPatch` sendet `zertifikat_pin` nur bei Änderung, leer → `null`.
- `webhookFehlerText('tls')` bleibt **ein neutraler Text** für Verlauf und letzten Fehler („Das
  Zertifikat des Ziels wurde nicht anerkannt.“): Ob beim jeweiligen Versuch schon ein Pin galt,
  ist nicht gespeichert, und ein alter Fehler von vor dem Pin bliebe sonst falsch beschriftet.
  Steht der Webhook mit gesetztem Pin in der Störung mit `tls`, zeigt das Paneel „Zustellung“
  dazu den Hinweis „Hat das Ziel sein Zertifikat gewechselt? Fingerabdruck neu holen.“ (eigene
  Entscheidung nach dem Builder-Check; kein Pin-Merkmal je Versuch).
- Zugangsprotokoll: Texte für die zwei neuen Aktionen in `zugangsprotokollText.ts`.

### D6 Regeln und Doku

- ADR-0046: neue Regel „MUST: Mit hinterlegtem Fingerabdruck verbindet der Webhook-Client nur mit
  genau diesem Zertifikat; Kette, Name und Vertrauensanker zählen dann nicht. Der Zielschutz gilt
  unverändert.“; „Konsequenzen“ ohne den Verweis „bis Zertifikats-Pinning kommt“. Ob als Änderung
  der ADR oder als neue ADR, entscheidet `docs/architektur/AGENTS.md`.
- `src/AGENTS.md`, „Webhooks“: ein Punkt zum Pin (ein Client je Pin aus `baue_client`, TLS nur über
  `instanz::zertifikat::tls_config`, Abruf nur mit erfassendem Verifier).
- Anwenderdoku `docs/anwender/kapitel/anbindungen.md`: Abschnitt zum Fingerabdruck (Mitänderungs-
  regel in `docs/anwender/AGENTS.md`).

## Tests (Akzeptanzkriterien)

- Unit: Normalisierung (Doppelpunkte, Groß/klein, falsche Länge, Nicht-Hex, leer).
- Gegen eine echte TLS-Gegenstelle mit rcgen-Zertifikat (Muster `instanz/zertifikat/tests.rs`):
  der TLS-Teil des Webhook-Clients mit passendem Pin stellt zu; mit anderem Pin scheitert er und
  `fehler_art` liefert `tls`. Loopback bleibt für den echten Weg gesperrt; die Tests prüfen die
  TLS-Konfiguration ohne den Resolver, und ein eigener Test zeigt, dass der gepinnte Client
  Loopback weiter mit `ziel_intern` ablehnt.
- Erfassender Verifier: liefert den Fingerabdruck der Gegenstelle, und die Gegenstelle sieht keine
  HTTP-Anfrage.
- Integration der Routen: anlegen mit Pin, PATCH setzen/wechseln/entfernen samt Admin-Spur und
  Zurücksetzen der Störung, ungültiger Pin → 400, neuer Host ohne Angabe zum Pin → 400, neuer
  Pfad am selben Host behält den Pin, Abruf nur für System-Admin und mit Admin-Spur, Abruf mit
  internem Ziel → `fehler_art`.
- Admin-Spur: der bestehende Test `jede_aktion_passiert_den_db_check` deckt die neuen Aktionen.
- Frontend: `webhookPatch` mit Pin, Anzeige gruppiert, Bestätigungsdialog übernimmt erst nach
  „Übernehmen“.

## Dem Umsetzenden überlassen

- Name und Ort der Normalisierungsfunktion, die Darstellung der Gruppen (gibt es im Frontend
  schon einen Formatierer für Fingerabdrücke, ihn nutzen).
- Genauer Zuschnitt des Cache-Schlüssels und der Hilfsfunktionen in `ziel.rs`.
- Wortlaut der Anwenderdoku im Rahmen von D5.
