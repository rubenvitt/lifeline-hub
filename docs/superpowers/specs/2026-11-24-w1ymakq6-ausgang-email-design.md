# Ausgang per E-Mail: Ausgangskorb, Kanaladressen und SMTP-Anbindung (LLH-2093)

Zunder: https://zunder.rubeen.dev/#/aufgabe/w1ymakq6rzew0lggh2ewwbxs
(Unteraufgabe von LLH-1197, Konzept `docs/konzepte/2026-11-10-schnittstellen-ausbau.md`)

Stand: 24.11.2026, Entwurf. Abgestimmt am Phase-1-Checkpoint: Schnitt, Ablage der Adressen,
SMTP als Anbindung, Wiederholung.

## Absicht

Heute kann Lifeline Hub nichts nach außen senden. Lageberichte, Befehle und Nachforderungen
werden ausgedruckt, abgetippt oder kopiert, bevor sie die Leitstelle, die Behörde oder den
Nachbar-EA erreichen. Dieser Schnitt baut den ersten Kanal: **E-Mail**. Ein Mensch löst den
Versand aus, der Server stellt zu, wiederholt kurz bei vorübergehenden Fehlern und schreibt den
Versand ins ETB. Damit ist der Weg vorbereitet, auf dem Matrix (LLH-2094), Fax (LLH-2095) und
Threema (LLH-2096) als weitere Kanäle folgen.

Leitplanken aus dem Konzept LLH-1191: G1 kein Versand ohne Menschen, G7 kein stiller Fehler,
G8 ohne Netz merkt der Server vor, E8 zuerst Klartext.

## Ziele

1. Eine Externe Stelle hat eine **Liste von Kanaladressen** (Kanal + Adresse + optionale
   Bezeichnung). In diesem Schnitt ist nur der Kanal `email` nutzbar.
2. Eine Organisation richtet einen **Mailserver** als Anbindung ein (Admin → Einstellungen →
   Anbindungen, Art „E-Mail (SMTP)“), mit verschlüsseltem Passwort und „Verbindung prüfen“.
3. **„Senden“** an einem freigegebenen Lagebericht, einem freigegebenen Befehl und an einer
   Nachforderung: Stelle und Adresse wählen, absenden.
4. Ein **Ausgangskorb am Server** stellt zu: `wartet → uebergeben | fehlgeschlagen`.
5. Jeder Versand steht im **ETB** (wer, was, an wen, wann, Ergebnis).
6. Am Dokument eine **Versandliste** mit Zustand je Versand und „Erneut senden“.

## Nicht-Ziele

- Matrix, Fax, Threema (eigene Unteraufgaben). Ihre Kanalwerte sind im Datenmodell vorgesehen,
  aber in API und Oberfläche gesperrt.
- PDF oder HTML-Mail. Entschieden wird das mit dem Fax (LLH-2095).
- Pressemitteilung: das Modul ist seit Migration 0303 entfernt.
- Automatischer Versand (etwa bei Freigabe oder Statuswechsel).
- Vormerken im Client ohne Netz: „Senden“ geht nur online (`SOFORT_ODER_NIE`); vorgemerkt wird
  am Server.
- Versand von gekoppelten ELW-Instanzen: Geheimnisse fließen nicht dorthin; der Adapter-Rahmen
  überspringt gekoppelte Orgs schon heute.
- Zustellnachweis über die Übergabe an den Mailserver hinaus (keine Lesebestätigung, kein DSN).
- Fremdbezug auf die Externe Stelle im Verteiler oder in der Nachforderung (Speicherform A
  bleibt: dort steht weiter Text).

## Anti-Ziele

- Ein Versand verschwindet still: jeder Fehlschlag ist am Dokument sichtbar und im ETB.
- Eine Mail geht an eine Adresse, die niemand bewusst gewählt hat.
- Ein Geheimnis (SMTP-Passwort) taucht in Log, Fehlertext, Antwort, ETB oder Admin-Spur auf.
- Ein überholter Lagebericht geht Stunden später raus, ohne dass jemand es merkt.
- Der Server verbindet sich mit einem Ziel, das der Zielschutz ablehnen würde (Loopback,
  gesperrte Netze; LAN nur mit Ausnahme).

## Ansätze

**Gewählt (Phase-1-Checkpoint): SMTP als Adapter-Art, eigener Ausgangskorb.**
Die Anbindung liegt im Adapter-Rahmen (Einstellungen, verschlüsseltes Passwort, Zustand,
„Verbindung prüfen“, Störungsmeldung nach ADR-0086). Die Nachrichten liegen in einer eigenen
Tabelle `ausgang` mit eigenem Lauf, weil der Rahmen abruft und keine Einzelnachricht kennt.
Dafür wird die Adapter-Regel in `src/AGENTS.md` erweitert und eine ADR angelegt.

Verworfen:
- **SMTP instanzweit per Startparameter.** Weniger Oberfläche, aber nicht je Organisation, nicht
  im Admin-Bereich prüfbar, und es widerspricht dem Geheimnisspeicher je Org aus dem Konzept.
- **Den Webhook-Ausgangskorb wiederverwenden.** Er ist ein Cursor je Empfänger über einen
  Ereignisstrom, keine Warteschlange je Nachricht; das Konzept trennt beide Wege ausdrücklich
  (`2026-11-11-oeffentliche-api.md`). Übernommen wird das Muster: reine Backoff-Funktion,
  `Zusteller`-Trait mit Testdoppel, Fehlercodes, keine DB-Verbindung während des Netzes.
- **Versand im Adapter-Lauf als `Uebernahme`.** Der Lauf läuft im Intervall der Anbindung, ein
  Versand müsste bis zum nächsten Takt warten, und `abrufen` darf keine Datenbank lesen.

Weitere am Checkpoint entschieden: Adressen als Liste je Stelle (statt fester Spalten);
vorübergehende Fehler kurz automatisch wiederholen (statt nur von Hand oder bis 24 h).

## Entwurf

### 1. Kanaladressen der Externen Stelle

Neue Tabelle `org_externe_stelle_kanal` (nächste freie Migration, heute 0373):

| Spalte | Inhalt |
|---|---|
| `id` | INTEGER PK (wie `org_externe_stelle`) |
| `org_id` | FK `organisation`, ON DELETE CASCADE |
| `externe_stelle_id` | INTEGER, FK `org_externe_stelle`, ON DELETE CASCADE |
| `kanal` | CHECK `email`, `fax`, `matrix`, `threema` |
| `adresse` | TEXT, Pflicht, je Kanal geprüft |
| `bezeichnung` | TEXT, optional („Einsatzpostfach“, „Lagedienst“) |
| `erstellt_at`, `aktualisiert_at` | Zeitstempel |

- `UNIQUE(externe_stelle_id, kanal, adresse)`.
- Alle vier Kanäle stehen schon im CHECK, damit die Nachzüge keinen Tabellenumbau brauchen.
  API und Oberfläche nehmen in diesem Schnitt **nur `email`** an (400 für andere Werte).
- E-Mail-Adresse: getrimmt, kleingeschrieben nur in der Domain, eine Adresse (kein Komma, kein
  Anzeigename), Prüfung mit dem Adress-Parser des Mail-Crates; höchstens 254 Zeichen.
- Routen unter dem Stammdaten-Präfix, damit `stammdaten_live` sie verteilt
  (`src/AGENTS.md`, Org-Ereignisse):
  `GET /api/external-agencies/{id}/channels`, `POST …/channels`,
  `PATCH …/channels/{kanal_id}`, `DELETE …/channels/{kanal_id}`. Schreiben nur `AdminUser`,
  lesen jeder der Org (wie die Stelle selbst). Org-Isolation wie im Repo der Stelle.
- Eine vom Hub synchronisierte Stelle ist schreibgeschützt (Trigger aus 0312); ihre Kanäle sind
  es auf der ELW-Seite ebenso. Ob die Kanaltabelle in den Stammdaten-Abgleich zum ELW gehört:
  **nein** in diesem Schnitt, weil das ELW nicht sendet.
- Änderungsspur: wie die übrigen Stammdaten-Kataloge (Trigger nach dem Muster aus 0312), falls
  `org_externe_stelle` eine hat.
- Oberfläche: im Formular der Externen Stelle (`stammdaten/ExterneStelleFormModal.tsx`) ein
  Abschnitt „Erreichbar per“ mit Liste und „Adresse hinzufügen“; in der Liste der Stellen
  (`ExterneStellenTab.tsx`) ein knapper Hinweis, wie viele Mailadressen eine Stelle hat.

### 2. SMTP-Anbindung (Adapter-Art `smtp`)

Neue Art im `Verzeichnis::produktiv()`:

- **Felder:** `host` (neuer Feldtyp `Host`, s. u.), `port` (Zahl, Vorschlag 587),
  `verschluesselung` (Text: `starttls` oder `tls`; per `check_extra`, **kein** Klartext),
  `benutzer` (Text, optional), `absender` (Text, Pflicht, eine Mailadresse),
  `absender_name` (Text, optional, z. B. „EL Hochwasser Kreis X“).
- **Platz:** `passwort` (optional, wenn der Relay ohne Anmeldung annimmt).
- **Intervall:** der Lauf prüft nur die Verbindung (EHLO, STARTTLS bzw. TLS, AUTH, QUIT; nichts
  wird gesendet). Minimum 15 min, Vorschlag 60 min. So meldet der Rahmen eine Störung des
  Mailservers nach ADR-0086 an die Admins, bevor jemand im Einsatz senden will. `Uebernahme`
  ist `OhneUebernahme(0)`.
- **Neuer Feldtyp `Host`** in `adapter::art::FeldTyp`: ein Hostname ohne Schema, Pfad und Port.
  `check_einstellungen` prüft ihn mit derselben Adressklassen-Regel wie URLs (Literal-IP oder
  Name; Loopback und gesperrte Netze abgelehnt, LAN nur mit `lan_erlaubt`), und
  `has_neues_ziel` zählt einen geänderten Host **wie eine geänderte URL**: das Passwort wird
  entfernt. Sonst ginge ein gesetztes Passwort an einen frei gewählten Server.
- **Verbindung nur über `adapter::ziel`:** dort entsteht die im Rahmen-Entwurf angekündigte
  geprüfte Adressauflösung für Nicht-HTTP-Ziele (`filter_adressen` aus
  `public_api/webhook/ziel.rs` herausziehen oder mitnutzen). Der SMTP-Client verbindet sich mit
  der **geprüften IP**, nicht erneut mit dem Namen (kein DNS-Rebinding). Das Zertifikat wird
  gegen den Hostnamen geprüft (SNI), über die gemeinsame TLS-Konfiguration
  (`instanz::zertifikat::tls_config`, rustls mit `aws_lc_rs`). Zeitlimits: Verbindung 5 s, jede
  Antwort 30 s, gesamte Sitzung 120 s.
- **Ein kleiner eigener SMTP-Client** in `adapter::ziel` (bzw. `adapter::smtp`) über
  `tokio` + `tokio-rustls` mit `tls_config`: EHLO, STARTTLS oder implizites TLS, AUTH PLAIN
  (LOGIN als Rückfall), MAIL, RCPT, DATA mit Dot-Stuffing, QUIT; Antworten mit Größendeckel.
  **Entscheidung des Entwurfs:** `lettre` dient nur zum **Bauen** der Nachricht (Feature
  `builder`, ohne Transport). Gründe: lettres Transport nimmt keine fertige rustls-`ClientConfig`
  und brächte womöglich einen zweiten Crypto-Provider (verboten, `Cargo.toml`); er verbindet sich
  selbst mit dem Namen statt der geprüften IP; und „ungewiss“ (Abbruch nach DATA) lässt sich nur
  mit eigener Kontrolle über die Phasen sicher erkennen. Lizenzen und Advisories nach
  `scripts/AGENTS.md`. Ein `Zweck` für den User-Agent entfällt; EHLO-Name ist der öffentliche
  Hostname der Instanz, falls konfiguriert, sonst `lifeline-hub`.
- **Testbarkeit des Clients:** ein Wegwerf-SMTP-Server im Test (Loopback, mit Testschalter am
  Zielschutz wie bei den Webhook-Tests), der Antworten skriptet, auch Abbruch nach DATA.
- **Fehlercodes der Anbindung** (neu in `AdapterFehler`, mit Einteilung in `braucht_eingriff`,
  Text in `benachrichtigung::adapter::fehler_text` und `frontend/src/api/adapter.ts`): nur was
  die **Verbindung** betrifft: `smtp_anmeldung` (535 u. ä., Eingriff), `smtp_tls`
  (Zertifikat/Handshake, Eingriff); Netz, Zeitüberschreitung, Zielschutz mit den bestehenden
  Codes. Fehler einer **einzelnen Nachricht** sind keine Adapterfehler, sondern Codes des
  Ausgangskorbs (Abschnitt 3).
- Höchstens **eine SMTP-Anbindung je Org**, gezählt werden alle, auch angehaltene. Eine zweite
  anzulegen ist 422. Grund: der Absender soll nicht vom Zufall abhängen.
- **Zustand der Anbindung und Versand:** Senden setzt eine SMTP-Anbindung voraus, die **nicht
  angehalten** ist (`zustand = 'aktiv'`, gestört ist erlaubt). Ist sie angehalten, lehnt das
  Anlegen mit 422 ab („Mailserver angehalten“), wartende Versände werden `fehlgeschlagen` mit
  `anbindung_angehalten`. Ein Versand ändert den Zustand der Anbindung **nie selbst**
  (ADR-0086: nur der Lauf meldet). Endet eine Zustellung mit einem Verbindungsfehler, der einen
  Eingriff braucht (Anmeldung, TLS), zieht der Ausgangskorb den nächsten Prüflauf der Anbindung
  auf „jetzt“ vor (`repo::postpone`); der Lauf stellt den Fehler dann selbst fest und meldet ihn
  nach den bestehenden Regeln.

### 3. Ausgangskorb (`src/ausgang/`)

Neue Tabelle `ausgang` (Migration im selben Zug):

| Spalte | Inhalt |
|---|---|
| `id` | TEXT PK |
| `org_id`, `einsatz_id` | FK, Einsatz ON DELETE CASCADE (Aufbewahrung wie ETB, s. u.) |
| `client_id` | TEXT, `UNIQUE(org_id, client_id)`: doppeltes Absenden liefert denselben Versand |
| `quelle_art` | CHECK `lagebericht`, `befehl`, `nachforderung` |
| `quelle_id` | ID des Dokuments bzw. der Nachforderung |
| `kanal` | CHECK wie oben; heute nur `email` |
| `externe_stelle_id` | Verweis zur Anzeige, ON DELETE SET NULL |
| `stelle_bezeichnung`, `adresse` | Schnappschuss beim Absenden |
| `betreff`, `inhalt` | Schnappschuss des Textes beim Absenden |
| `zustand` | CHECK `wartet`, `uebergeben`, `fehlgeschlagen` |
| `versuche`, `naechster_versuch_at`, `erster_versuch_at` | Wiederholung |
| `fehler_art`, `fehler_status` | letzter Fehler als `AusgangFehler`-Code + SMTP-Code, nie Text des Ziels |
| `versuch_begonnen_at` | gesetzt vor der Zustellung, geleert mit dem Ergebnis |
| `erstellt_von_id`, `erstellt_at`, `uebergeben_at` | wer, wann |
| `etb_eintrag_id` | letzter ETB-Eintrag dieses Versands |

- **Ein Versand = eine Adresse.** Wer an drei Stellen sendet, erzeugt drei Zeilen (eine
  Anfrage, drei `client_id`-Ableitungen oder eine `client_id` je Zeile vom Client).
- **Anlegen** (`POST …/deliveries` am Dokument, s. Abschnitt 5) prüft in einer Transaktion:
  Schreibrecht im Modul, Einsatz aktiv und **kein Spiegel** (s. u.), Quelle im richtigen
  Zustand, Stelle **aktiv** und Kanaladresse gehören zur Org, Kanal `email`, eine nicht
  angehaltene SMTP-Anbindung existiert (sonst 422 mit Code, damit die Oberfläche „Kein
  Mailserver eingerichtet“ zeigen kann). Dann `zustand = wartet`,
  `naechster_versuch_at = jetzt`, und der Lauf wird geweckt.
- **Quelle im richtigen Zustand:**
  - Lagebericht und Befehl: freigegeben **und die jüngste freigegebene Version ihrer Kette**
    (dieselbe Bedingung wie `quittierbar_column` in `vorlagendokument/repo.rs`). Eine überholte
    Version zu senden ist 422.
  - Nachforderung: nicht `zurueckgezogen` und nicht `abgelehnt`.
  - Dieselbe Prüfung läuft bei „Erneut senden“ und **vor jeder Zustellung** im Lauf: ist die
    Quelle inzwischen überholt oder zurückgezogen, wird der Versand ohne Netz
    `fehlgeschlagen` mit `ueberholt`. So geht kein überholter Lagebericht im Wiederholungsfenster
    hinaus.
- **Fehlercodes des Ausgangskorbs** (`AusgangFehler`, eigener Enum mit Enum-Kontrakt und
  Texten im Frontend): `voruebergehend` (4xx, Netz, Zeit), `abgelehnt` (5xx bei MAIL/RCPT/DATA),
  `ungewiss`, `ueberholt`, `anbindung_fehlt`, `anbindung_angehalten`, `anbindung_fehler`
  (Anmeldung/TLS/Zielschutz, Einzelheit steht an der Anbindung), `zu_gross`, `spiegel`.
- **Spiegel (ADR-0018):** `ausgang` ist eine Einsatztabelle und wird in
  `instanz::spiegel::art::AUSGENOMMEN` eingetragen, Grund: „Zustellung ist an die Instanz mit
  Anbindung und Geheimnis gebunden; der Versand steht über das ETB im Spiegel“. Auf einem
  Spiegel (Einsatz von einer anderen Instanz geführt) lehnt das Anlegen mit 422 `spiegel` ab.
  Wird ein Einsatz zwischen Anlegen und Zustellen zum Spiegel (Führungswechsel), stellt der Lauf
  nicht zu, sondern setzt `fehlgeschlagen` mit `spiegel`, ohne ETB-Eintrag (der wäre gesperrt);
  die Versandliste zeigt es. Ein Versand ist nie halb: entweder zugestellt **und** im ETB oder
  sichtbar fehlgeschlagen.
- **Schwärzung:** `ausgang` kommt in `einsatz::schwaerzung_registry::TABELLEN`; `betreff`,
  `inhalt`, `adresse` und `stelle_bezeichnung` werden geschwärzt wie der Text des ETB-Eintrags.
- **Einsatz endet:** Wartende Versände eines Einsatzes, der abgeschlossen oder archiviert wird,
  laufen weiter bis zum Ergebnis (das ETB nimmt Systemeinträge nach dem Muster der übrigen
  Systemprotokolle an; prüft der Builder, sonst `fehlgeschlagen` ohne Zustellung).
- **Lauf** (`ausgang::lauf`): Takt 2 s und Wecken per `Notify` beim Anlegen; höchstens 4
  gleichzeitig, eine Laufmenge gegen Doppelzustellung; **keine DB-Verbindung während SMTP**.
  Ablauf je Versand: fällige Zeile und SMTP-Anbindung der Org laden, Passwort entschlüsseln
  (über eine neue Funktion in `adapter::lauf`, s. Regel unten), Nachricht bauen, zustellen,
  Ergebnis in einer Transaktion schreiben (`write_retry!`), ETB schreiben, danach
  `live.publiziere` und das Einsatz-Ereignis für die Versandliste.
- **Wiederholung:** vorübergehende Fehler (Netz, Zeitüberschreitung, 4xx, Mailserver nicht
  erreichbar) mit Backoff `30 s · 2^(n−1)`, gedeckelt auf 5 min, solange seit `erster_versuch_at`
  weniger als **30 min** vergangen sind; danach `fehlgeschlagen`. Dauerhafte Fehler (5xx,
  Anmeldung, TLS, Zielschutz, Anbindung angehalten oder gelöscht) sofort `fehlgeschlagen`.
  Die Backoff-Funktion ist rein und einzeln getestet.
- **Ungewisse Übergabe:** bricht die Verbindung **nach** dem Senden von DATA ab, bevor der
  Mailserver mit 250 antwortet, ist unklar, ob die Mail raus ist. Dann `fehlgeschlagen` mit
  Code `ungewiss` und **ohne** automatische Wiederholung; die Versandliste zeigt „Zustellung
  unklar“, und „Erneut senden“ bleibt eine bewusste Entscheidung des Menschen. (Entscheidung des
  Entwurfs: lieber ein Handgriff als eine doppelte Nachforderung bei der Leitstelle.)
- **Erneut senden** (`POST /api/einsaetze/{id}/deliveries/{did}/retry`): nur aus
  `fehlgeschlagen` und nur, solange die Quelle nicht überholt ist (sonst 422), gleiche Rechte
  wie Anlegen, setzt `versuche = 0`, neues
  `erster_versuch_at`, `zustand = wartet`. Es sendet den **Schnappschuss**, nicht eine neuere
  Fassung des Dokuments; für eine Fortschreibung sendet man die neue Version.
- **Neustart des Servers:** Zeilen in `wartet` laufen weiter. Eine Zeile, die beim Absturz
  mitten in der Zustellung war, wird wie „ungewiss“ behandelt, wenn ihr letzter Versuch begonnen,
  aber nicht beendet wurde (Merker `versuch_begonnen_at`).
- **Aufbewahrung:** Zeilen gehören zum Einsatz und fallen mit ihm nach den Regeln von
  `src/aufbewahrung` (der Builder ordnet die Tabelle dort ein).

### 4. Nachricht

- **Von:** `absender_name <absender>` der Anbindung. **An:** die gewählte Adresse.
  **Message-ID:** `<ausgang-{id}@{host der Instanz}>`, damit Rückfragen zuzuordnen sind.
- **Betreff:**
  - Lagebericht: `Lagebericht Nr. {nr} – {Einsatzname} – Stand {Zeitstand}`
  - Befehl: `Einsatzbefehl Nr. {nr} – {Einsatzname}`
  - Nachforderung: `Nachforderung: {anzahl}× {bezeichnung} – {Einsatzname}`
  (Nummer und Feldnamen nimmt der Builder aus den Modellen.)
- **Text:** `text/plain; charset=utf-8`.
  - Lagebericht und Befehl: beim Anlegen des Versands **neu gerendert** aus der freigegebenen
    Version, mit demselben Weg wie beim Freigeben (`render_snapshot` samt Anlagen- und
    Verteilerteil, also derselbe Code, den `snapshot_freigeben_tx` nutzt; der Builder zieht ihn
    als Funktion heraus). Die freigegebene Version ist unveränderlich, also ergibt das denselben
    Text, der ins ETB ging. **Nicht** aus dem ETB-Eintrag gelesen: dessen Text kann seither
    berichtigt worden sein, und die Mail soll das Dokument tragen, nicht das Protokoll.
    Markdown bleibt als Text stehen; er ist so gebaut, dass er lesbar ist.
  - Nachforderung: ein kleiner Textrenderer aus den Feldern (Art, Bezeichnung, Anzahl,
    Priorität, Begründung, Ziel, benötigt bis, Absender-Einsatz), im Stil von `anlage_text`.
  - Fuß: Einsatzname, absendende Person mit Funktion, „Gesendet mit Lifeline Hub“, Uhrzeit.
- **Anhänge:** die PNG-Anlagen des freigegebenen Lageberichts bzw. Befehls
  (`vorlagendokument::anlage`), Dateiname `anlage-{n}.png`; Summe höchstens 20 MiB, sonst wird
  beim Anlegen mit 422 abgelehnt. Die Nachforderung hat keine Anhänge.
- Der Schnappschuss (`betreff`, `inhalt`) wird beim **Anlegen** in `ausgang` gespeichert; die
  Anhänge liest der Lauf beim Zustellen aus den unveränderlichen Anlagen der freigegebenen
  Version.

### 5. Routen und Rechte

Festes Segment `deliveries` (Versand) ins Glossar `scripts/api-routen-woerter.tsv`;
`dispatch` ist dort schon als „Abruf“ belegt.

- `POST /api/einsaetze/{id}/situation-reports/{lid}/deliveries`
- `POST /api/einsaetze/{id}/orders/{bid}/deliveries`
- `POST /api/einsaetze/{id}/resource-requests/{nid}/deliveries`
  - Body: `{ client_id, recipients: [{ channel_id }] }` (die Kanaladresse bestimmt Stelle,
    Kanal und Adresse). Antwort: die angelegten Versände.
- `GET /api/einsaetze/{id}/deliveries?source_kind=…&source_id=…` (Versandliste einer Quelle;
  ohne Filter alle des Einsatzes, für spätere Übersichten)
- `POST /api/einsaetze/{id}/deliveries/{did}/retry`
- Rechte: Senden und Erneut senden wie Schreiben im jeweiligen Modul (`fordere_schreiben` für
  Lagebericht/Befehl, `EinsatzSchreibzugriff<Nachforderungen>`); Lesen wie Lesen im Modul.
- Statuscodes nach `src/AGENTS.md`: 400 Feld (unbekannter Kanal, leere Empfängerliste),
  422 Kontext (Quelle nicht freigegeben, kein Mailserver, Anhänge zu groß, Retry aus falschem
  Zustand), 404 fremde Org.
- Neue Request-/Response-Typen mit englischen Wire-Feldern; Typ-Codegen mitziehen.

### 6. ETB

- Geschrieben wird beim **Ergebnis**, nicht beim Anlegen: einmal bei `uebergeben` und einmal bei
  `fehlgeschlagen` (bei einem erneuten Senden kommt wieder ein Eintrag beim Ergebnis).
  Text z. B. „Lagebericht Nr. 3 per E-Mail an Leitstelle Nord (lagedienst@…) übergeben“ bzw.
  „… nicht zugestellt: Anmeldung am Mailserver abgelehnt“.
- `erfasser_id` = die absendende Person, `von` = ihre Funktion bzw. ihr Name wie bei anderen
  Einträgen dieser Person, `an` = `stelle_bezeichnung`. Typ und Startwert wie bei
  `nachforderung::repo::protokollieren_tx`; Eintrag über `etb::repo::anlegen_tx` in der
  Ergebnis-Transaktion, Verteilung nach dem Commit; der Lauf ist in `nachlauf::klammer`
  gewickelt (`src/AGENTS.md`, ETB live verteilen).

### 7. Oberfläche

- **Senden-Dialog** (`ErfassungsModal`, Verb „Senden“ mit Begründung im Verb-Wächter):
  - Lagebericht/Befehl: Aktion „Senden“ im Kopf neben „Fortschreiben“, nur bei `freigegeben`.
  - Nachforderung: Eintrag „Senden“ im Menü der Karte.
  - Inhalt: Liste der Mailadressen der **aktiven** Externen Stellen zum Anhaken. **Vorbelegt** sind die
    Adressen der Stellen, deren Bezeichnung einem externen Verteiler-Eintrag bzw. dem Adressaten
    der Nachforderung gleicht (Vergleich ohne Groß/Klein und Leerraum). Darunter Betreff und der
    Beginn des Textes als Vorschau; Anzahl und Größe der Anhänge.
  - Gesperrt mit sichtbarem Grund: „Kein Mailserver eingerichtet“ (Hinweis für Admins mit Weg
    zu Anbindungen), „Keine Mailadresse hinterlegt“ (Weg zu Stammdaten für Admins).
  - Ohne Netz: Knopf gesperrt mit Grund „Ohne Netz nicht möglich“ (`SOFORT_ODER_NIE`).
- **Versandliste** am Dokument bzw. an der Karte: je Versand Stelle, Adresse, Zeit, Zustand
  („wartet“, „übergeben 14:32“, „fehlgeschlagen: …“, „Zustellung unklar“) und bei
  fehlgeschlagen „Erneut senden“. Aktualisiert über ein neues Einsatz-Stream-Ereignis
  (`ausgang`), Query-Key neu in `api/queryKeys.ts`, live klassifiziert, für `LAGEBILD_OFFLINE`
  bewusst ausgelassen.
- **Anbindungen:** die Art „E-Mail (SMTP)“ erscheint mit ihren Feldern im bestehenden
  Adapter-Paneel; keine eigene Seite.
- Texte nach `frontend/AGENTS.md` (zeigen statt erklären, keine Anrede).

### 8. Regel und Entscheidung (E2)

- **ADR** (nächste freie Nummer, heute ADR-0098): „Nachrichten an Menschen gehen nur über den
  Ausgangskorb: ein Mensch löst aus, der Server stellt zu, jeder Versand steht im ETB.“ Enthält:
  getrennt von Webhooks (ADR-0038/0046), Anbindung im Adapter-Rahmen (ADR-0077), Schnappschuss
  beim Absenden, kurze Wiederholung, „ungewiss“ ohne Automatik.
- **`src/AGENTS.md`**, neuer Abschnitt „Ausgang an Menschen“ und Ergänzung im Abschnitt
  Adapter: Eine Art darf außer dem Lauf auch einen **Versandweg** haben; das Geheimnis
  entschlüsselt dann `adapter::lauf::zugang_fuer_versand` (einzige Stelle neben dem Lauf),
  der Ausgangskorb hält es nur für die Dauer einer Zustellung. Keine zweite Tabelle für
  Geheimnisse oder Zustand der Anbindung; die Tabelle `ausgang` hält Nachrichten, nicht den
  Zustand der Anbindung.
- `docs/architektur`: Mitänderungsregel nach `docs/architektur/AGENTS.md` (Bausteinsicht,
  Laufzeitsicht „Versand“).
- `docs/anwender`: Kapitel bzw. Abschnitt „Senden an Externe Stellen“ nach
  `docs/anwender/AGENTS.md`.

## Testbarkeit

- Ein `Zusteller`-Trait im Ausgangskorb (wie bei den Webhooks) mit echtem `SmtpZusteller` und
  einem skriptbaren Testdoppel; Tests laufen ohne Mailserver.
- Der eigene SMTP-Client wird gegen den Wegwerf-Server im Test geprüft (Abschnitt 2), auch
  STARTTLS mit selbstsigniertem Testzertifikat, Dot-Stuffing und Abbruch nach DATA.
- Pflichtfälle des Ausgangskorbs: überholte Version beim Anlegen, beim Erneut senden und im
  Wiederholungsfenster; Spiegel beim Anlegen und nach Führungswechsel; angehaltene Anbindung;
  Neustart mit `versuch_begonnen_at`; `client_id` doppelt; fremde Org.
- e2e: ein Lauf „Lagebericht freigeben → Senden → Versandliste zeigt übergeben“ mit Testdoppel
  im Testbetrieb.

## Dem Builder überlassen

- Schnitt der Module und Dateien in `src/ausgang/`, Namen der Funktionen.
- Genaue Betreffzeilen und Fußtext, Wortlaut der Fehlertexte.
- Ob die Kanaladressen im Formular der Stelle oder in einem eigenen kleinen Dialog gepflegt
  werden, solange beides über `ErfassungsModal` läuft.
- Ob `filter_adressen` verschoben oder mitbenutzt wird.
- Einordnung in Aufbewahrung und Änderungsspur nach den bestehenden Mustern.
