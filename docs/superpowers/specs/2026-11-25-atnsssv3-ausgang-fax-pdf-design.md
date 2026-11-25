# Ausgang per Fax (sipgate) und PDF am Server (LLH-2095)

Zunder: https://zunder.rubeen.dev/#/aufgabe/atnsssv3lxb9m7h4r2rkr8ag
(Unteraufgabe von LLH-1197, Konzept `docs/konzepte/2026-11-10-schnittstellen-ausbau.md`, E8)

Stand: 25.11.2026, Entwurf. Abgestimmt am Phase-1-Checkpoint am 25.11.2026: Das PDF entsteht am
Server in schlankem Rust. Es gibt den Zustand „zugestellt“ mit Abfrage bei sipgate. Der Schnitt
setzt auf PR #1711 (LLH-2093) auf. Das PDF geht auch an E-Mails.

## Absicht

Viele Behörden und Leitstellen empfangen Lageberichte und Nachforderungen **noch per Fax**. Mit
LLH-2093 kann Lifeline Hub per E-Mail senden. Dieser Schnitt fügt **Fax über sipgate** als
zweiten Kanal im Ausgangskorb hinzu.

sipgate nimmt nur PDF an. Deshalb fällt hier die offene Entscheidung E8 aus dem Konzept: **Das
PDF entsteht am Server.** Der Server stellt im Ausgangskorb zu, auch wenn kein Browser mehr offen
ist (G8). Ein PDF aus dem Browser könnte er nicht nachsenden. Weil das PDF ohnehin entsteht,
bekommt es auch die E-Mail als Anhang. So sieht die Gegenstelle auf beiden Wegen dasselbe
Dokument.

Ein Fax ist erst dann angekommen, wenn die Gegenstelle abgenommen hat. sipgate bestätigt beim
Absenden nur die Annahme. Der Ausgangskorb fragt deshalb nach und zeigt **„zugestellt“** oder
**„nicht zugestellt“**. Ein Fax, das an einer besetzten Leitung scheitert, wird so sichtbar (G7).

Leitplanken aus dem Konzept: G1 kein Versand ohne Menschen, G7 kein stiller Fehler, G8 ohne Netz
merkt der Server vor.

## Ziele

1. Eine Externe Stelle kann **Faxnummern** als Kanaladresse tragen (Kanal `fax`). Die Nummer
   wird beim Speichern geprüft und einheitlich nach E.164 abgelegt.
2. Eine Organisation richtet **sipgate Fax** als Anbindung ein (Admin → Einstellungen →
   Anbindungen, Art „Fax (sipgate)“). Dazu gehören Token-ID, ein verschlüsseltes Token, die
   Fax-Durchwahl und „Verbindung prüfen“.
3. Im **„Senden“-Dialog** stehen je Stelle die Mailadressen und die Faxnummern zur Wahl.
4. Aus Schnappschuss und Anlagen entsteht am Server ein **PDF**. Es geht als Fax an sipgate und
   als Anhang an jede E-Mail.
5. Ein Fax durchläuft `wartet → uebergeben → zugestellt | fehlgeschlagen`. Für `uebergeben → …`
   fragt der Lauf den Status bei sipgate ab.
6. Das ETB, die Versandliste und die Texte nennen den Kanal (E-Mail oder Fax) und den passenden
   Grund.
7. Eine **ADR** hält fest: Ein PDF entsteht am Server nur für den Ausgang. Gedruckt wird weiter
   nur im Browser.

## Nicht-Ziele

- Matrix (LLH-2094), Threema (LLH-2096), SMS über sipgate.
- Fax-Eingang und Texterkennung von Faxen (im Konzept ausgeschlossen, das kann FE2).
- Das PDF ersetzt den Browserdruck nicht. „Drucken / als PDF“ bleibt, wie es ist.
- Ein PDF für andere Dokumente als Lagebericht, Befehl und Nachforderung (etwa Einsatzbericht,
  ETB-Auszug).
- Ein Zustellnachweis für E-Mails. Eine E-Mail endet weiter bei `uebergeben`.
- Mehrere Fax-Anbindungen je Org oder andere Fax-Anbieter.
- Ein Deckblatt als eigene Seite. Der Kopf der ersten Seite trägt die Angaben.

## Anti-Ziele

- Ein Fax geht doppelt raus, weil nach einer abgebrochenen Verbindung blind wiederholt wurde.
  Nach dem Absenden zählt nur ein bewusstes „Erneut senden“.
- Ein Fax bleibt dauerhaft auf `uebergeben`, ohne dass jemand erfährt, ob es ankam.
- Das Token taucht in Log, Fehlertext, Antwort, ETB oder Admin-Spur auf.
- Das PDF sieht anders aus als der freigegebene Stand: anderer Text, fehlende Anlage, fehlende
  ÜBUNG-Kennzeichnung.
- Das Laufzeitbild wächst um einen Browser, eine Shell oder Systemschriften.

## Ansätze

**Gewählt (Phase-1-Checkpoint): PDF am Server in schlankem Rust.** Eine kleine, gepflegte
PDF-Bibliothek ohne Systemabhängigkeiten (Vorgabe `printpdf`, MIT) und eine eingebettete Schrift
aus dem Repo. Das PDF entsteht im Lauf aus dem Schnappschuss (`betreff`, `inhalt`) und den
unveränderlichen PNG-Anlagen der Freigabe. So sendet der Server auch ohne offenen Browser nach.
Das Layout ist schlicht (Kopf, umbrochener Text, Anlagen je eine Seite), und das reicht für ein
Fax in Schwarz-Weiß bei 200 dpi.

Verworfen:

- **typst als Bibliothek.** Es liefert ein schöneres Layout mit Tabellen und Markdown. Dafür ist
  die Abhängigkeit schwer: Bauzeit, Binärgröße und Schriftverwaltung. Für ein Fax ist der Gewinn
  klein.
- **Der Browser erzeugt das PDF beim Senden.** Es gäbe keinen Layout-Code am Server, aber der
  Versand hinge am Browser. Safari hat keinen verlässlichen PDF-Weg, und „der Server sendet
  nach“ bräche, weil das PDF beim Absenden schon fertig sein müsste.
- **Headless Chromium am Server.** Das Laufzeitbild ist distroless (`gcr.io/distroless/cc`). Ein
  Browser bräuchte ein anderes Basisbild und Schriften, und das widerspricht dem Anti-Ziel.

**Zustellung:** Gewählt ist der Zustand `zugestellt` mit Abfrage der sipgate-History. Verworfen
ist „Fax endet bei `uebergeben` wie E-Mail“: Ein Fax, das nicht ankommt, bliebe still (G7).

**Basis:** Gewählt ist, auf #1711 aufzusetzen. #1711 kollidiert derzeit mit `alpha`, unter
anderem bei der ADR-Nummer 0103 (auf `alpha` belegt durch die Fahrzeugortung). Die Umsetzung
beginnt erst, wenn #1711 auf `alpha` nachgezogen oder gemergt ist. Dann zieht dieser Branch es
nach.

## Entscheidungen im Einzelnen

### 1. Kanal `fax` freischalten

- `KanalArt::Fax` gilt als freigeschaltet (`is_freigeschaltet`). Matrix und Threema bleiben
  gesperrt.
- `pruefe_adresse` bekommt `kanal::normalize_fax`. Es nimmt eine Nummer mit `+`, mit `00` oder
  national mit führender `0` an. Ohne Länderkennung gilt `+49`. Leerzeichen, `-`, `/`, `(` und
  `)` werden entfernt. Ergebnis ist E.164 (`+` und 8–15 Ziffern). Alles andere ergibt 400 mit
  einem deutschen Text. *(Builder: Die genauen Grenzen legt ein Property-Test fest.)*
- Die Sammlung `GET /api/external-agencies/channels?channel=` nimmt `email` und `fax` an.
  `list_email_fuer_org` wird zu `list_fuer_org(kanal)`, ohne das fest verdrahtete `'email'` im
  SQL und ohne `debug_assert`.
- Der Test `fax_ist_noch_nicht_freigeschaltet` wird zu einem Test, der Matrix und Threema als
  gesperrt festhält.

### 2. Adapter-Art „Fax (sipgate)“

- Neue Datei `src/adapter/sipgate_fax_art.rs` mit Code `sipgate_fax`, registriert in
  `Verzeichnis::produktiv`. Höchstens eine je Org, nach derselben Regel wie SMTP.
- Felder: `token_id` (Text, Pflicht), `faxline_id` (Text, Pflicht, Form `f` + Ziffern, etwa
  `f0`) und `absender_kennung` (optional, erscheint nur im PDF-Kopf, etwa „ELW 1 Kreis X“; ohne
  Angabe gilt der Org-Name). Der Geheimnis-Platz heißt `token`, ein Personal Access Token mit
  den Scopes `sessions:fax:write` und `history:read`.
- Das Ziel ist fest `https://api.sipgate.com`, ohne Host-Feld. Abrufe laufen über den
  bestehenden `adapter::ziel` / `http_begrenzt` ohne Weiterleitungen.
- Der periodische Lauf prüft nur die Verbindung (`OhneUebernahme(0)`, mindestens 15 min), wie bei
  SMTP (ADR-0086). Geprüft wird mit einem billigen authentifizierten GET. *(Builder: Den Endpunkt
  gegen die offizielle API-Doku `https://api.sipgate.com/v2/doc` festlegen; vorgesehen ist ein
  Abruf, der Token und Faxline-Recht prüft.)*
- Mit LLH-2126 bekommt die Art das Merkmal „versendet nur“, sobald es das gibt. Dieser Schnitt
  hängt nicht davon ab.

### 3. Versandweg je Kanal

Heute ist der Weg an vier Stellen auf SMTP verdrahtet. Er wird kanalbewusst, ohne zweiten Korb
und ohne zweiten Lauf (ADR der Ausgangskorb-Regel aus #1711):

- `pruefe_versand_moeglich(kanal)`, `zugang_fuer_versand(kanal)` und `repo::load_…_fuer_org`
  wählen die Adapter-Art nach dem Kanal (`email` → `smtp`, `fax` → `sipgate_fax`). Fehlt die
  Anbindung, antwortet die Route `anbindung_fehlt` mit kanalgerechtem Text („Kein Faxzugang
  eingerichtet“).
- `run_one` verzweigt auf `zeile.kanal`. E-Mail baut die Mail wie bisher und hängt das PDF an.
  Fax baut das PDF und übergibt es an sipgate.
- Zusteller: Der bestehende Mail-`Zusteller` bleibt. Daneben kommt ein `FaxZusteller` mit
  `senden(zugang, nummer, dateiname, pdf) -> Result<SessionId, FaxFehler>` und
  `status(zugang, session) -> Result<FaxStatus, FaxFehler>`. Dazu gibt es eine echte Umsetzung
  über HTTPS und einen aufzeichnenden Doppelgänger nur im Debug-Bau für Tests und e2e. Er ist
  steuerbar, sodass `SENT` oder `FAILED` gemeldet wird.
- Die Regeln aus #1711 bleiben: kein `.decrypt(` außerhalb von `zugang_fuer_versand`, keine
  DB-Verbindung während Netz-I/O, höchstens 4 parallel, kein Versand am Spiegel.

### 4. Fehler und Wiederholung beim Fax

Das Absenden (`POST /v2/sessions/fax`) wird so eingeordnet:

| Ergebnis | Einordnung |
| --- | --- |
| 200 mit `sessionId` | `uebergeben`, die Session-ID wird gespeichert |
| 401, 403 | `anbindung_fehler`, nächste Prüfung der Anbindung vorziehen |
| 402 (Guthaben) | `anbindung_fehler`, Grund „Guthaben bei sipgate aufgebraucht“ |
| 407 (Nummer ungültig), 400, 413, 415 | `abgelehnt`, ohne Wiederholung |
| 429, 5xx, Verbindung, DNS, Zeitüberschreitung **vor** dem Senden des Körpers | `voruebergehend`, Backoff wie bei E-Mail (30 s · 2ⁿ, höchstens 5 min, Fenster 30 min) |
| Verbindung bricht **nach** dem Senden des Körpers ab, keine Antwort | `ungewiss`, keine automatische Wiederholung (Anti-Ziel Doppel-Fax) |

`fehler_status` trägt den HTTP-Status. Das Wire-Feld heißt weiter `smtp_status`, weil es ein
Grenzwert ist (AGENTS.md, Bezeichner-Sprache). Die Oberfläche liest es je Kanal richtig.
*(Builder: Ob ein neues additives Feld `status_code` daneben lohnt, entscheidet der Plan.)*

### 5. Zustand „zugestellt“ und Nachfragen

- Migration mit Tabellenumbau (`migrations/AGENTS.md`). Der CHECK von `zustand` erweitert sich um
  `zugestellt`, der von `fehler_art` um `nicht_zugestellt`. Neue Spalten sind `anbieter_ref`
  (Session-ID, nur bei Fax), `zugestellt_at` und `naechste_abfrage_at`.
- `VersandZustand::Zugestellt`, `AusgangFehler::NichtZugestellt`, der Wire-Kontrakt
  (`tests/enum_wire_kontrakt.rs`) und der Typ-Codegen ziehen nach.
- Derselbe Lauf fragt Faxe auf `uebergeben` mit `anbieter_ref` ab
  (`GET /v2/history/{sessionId}`, Feld `faxStatusType`). Er fragt zuerst nach 30 s, dann alle
  60 s.
  - `SENT` → `zugestellt`, `zugestellt_at`
  - `FAILED` → `fehlgeschlagen` mit `nicht_zugestellt`. „Erneut senden“ ist möglich.
  - `PENDING`, `SENDING`, `SCHEDULED` → weiter abfragen
  - Fehler der Abfrage (Netz, 5xx) → später erneut. 401/403 → Anbindung vorziehen und weiter
    abfragen.
  - Kommt **nach 2 Stunden** kein Endstand, wird der Versand `fehlgeschlagen` mit `ungewiss` und
    dem Grund „Zustellung nicht bestätigt“. *(Meine Wahl: sipgate wählt selbst mehrfach neu, und
    zwei Stunden decken das sicher ab.)*
- Beim Start und bei hängenden Versuchen gilt die Wiederaufnahme aus #1711. Ein Fax auf
  `uebergeben` mit `anbieter_ref` wird einfach weiter abgefragt.
- **ETB:** Ein Fax bekommt seinen ETB-Eintrag beim **Endstand** (`zugestellt` oder
  `fehlgeschlagen`), nicht schon bei `uebergeben`, damit im ETB das steht, was zählt. Eine E-Mail
  bleibt wie bisher. *(Meine Wahl.)*
- Der Live-Hinweis `LiveEvent::Ausgang` geht auch bei `zugestellt` raus.

### 6. Das PDF

Neues Modul `src/ausgang/pdf.rs` (oder `src/pdf/`, nach Wahl des Builders), ohne Netz und ohne
DB: `fn baue_pdf(&PdfVorlage) -> Result<Vec<u8>, PdfFehler>`.

- **Format:** A4 hochkant, 20 mm Rand, schwarz auf weiß, keine Flächenfarben (Fax). Die Schrift
  ist eine eingebettete TTF mit freier Lizenz. Vorgabe ist Archivo (OFL, schon die Schrift der
  App) als TTF unter `assets/schriften/`, für den Text Regular und Bold. Umlaute und `ß` müssen
  stimmen.
- **Kopf der ersten Seite:**
  - eine Zeile mit Absender (`absender_kennung` oder Org-Name) und Zeit der Erzeugung
  - **ÜBUNG** groß und fett, wenn der Einsatz eine Übung ist (wie der Druckkopf)
  - der Betreff als Titel
  - darunter „An: {Stelle}“ (bei Fax mit Nummer)
  - die Einsatzbezeichnung
  - eine Trennlinie
- **Text:** der Schnappschuss-`inhalt` genau so, wie er als Mailtext geht, mit Absätzen,
  umbrochen an Wortgrenzen und überlangen Wörtern. Markdown-Zeichen bleiben stehen wie in der
  Mail, damit beide Wege dasselbe zeigen.
- **Anlagen:** Jede PNG-Anlage der Freigabe kommt auf eine eigene Seite mit Überschrift
  „Anlage n“. Sie wird proportional eingepasst und bei Bedarf auf Querformat gedreht.
- **Fuß jeder Seite:** „Seite x von y“ und `Lifeline Hub`.
- **Grenze:** höchstens 30 Seiten und 10 MiB. Darüber wird der Versand beim Anlegen mit
  `zu_gross` abgelehnt und nicht erst im Lauf. *(Meine Wahl: ein längeres Fax blockiert die
  Gegenstelle. Die Größe von 10 MiB ist geschätzt, der Builder prüft sie gegen die sipgate-Doku.)*
- **Dateiname:** `lagebericht-{version}.pdf`, `befehl-{version}.pdf` oder
  `nachforderung.pdf`.
- **Determinismus:** Gleiche Eingabe und gleiche Zeit ergeben dieselben Bytes (feste
  Metadaten), damit Tests stabil bleiben.

Für die E-Mail kommt das PDF als erster Anhang `application/pdf` hinzu. Die PNG-Anlagen bleiben
zusätzlich dran, der Mailtext bleibt. Die Grenze von 20 MiB für Anhänge aus #1711 zählt das PDF
mit.

### 7. Oberfläche

- `ExterneStelleKanaele.tsx` bekommt eine Kanalwahl (E-Mail oder Fax) beim Hinzufügen,
  Faxnummern mit `inputMode="tel"` und eine Prüfung im Client, die zur Server-Prüfung passt. Die
  Liste zeigt je Eintrag ein Symbol für den Kanal. `ExterneStellenTab` zählt beide Kanäle.
- `SendenDialog.tsx` zeigt je Stelle die Adressen beider Kanäle, gruppiert mit einem
  Kanal-Hinweis. Ist ein Kanal ohne Anbindung, steht dort der Hinweis („Kein Faxzugang
  eingerichtet“), statt die Adressen anzubieten.
- `Versandliste.tsx` zeigt den Kanal, den Zustand „zugestellt“ und die neuen Gründe.
  `api/ausgang.ts` erhält kanalgerechte Texte.
- Die Literal-Typen `'email'` in `api/externeStellen.ts` werden zu `KanalArt` aus den
  generierten Typen.
- Unter Anbindungen erscheint „Fax (sipgate)“ über `adapterAnzeige.ts`.

### 8. Doku und Wächter

- **Neue ADR** mit der nächsten freien Nummer: „Ein PDF entsteht am Server nur für den Ausgang“.
  - MUST: PDF am Server nur in `src/ausgang/` (bzw. `src/pdf/`) und nur aus Schnappschuss und
    Anlagen.
  - MUST NOT: kein Browser und keine Systemschrift im Laufzeitbild.
  - Gedruckt wird weiter im Browser.
  - Eine Prüfung per grep, dass `printpdf` nur dort benutzt wird.
- `frontend/src/druck/AGENTS.md`: Die Regel „nie auf dem Server“ bekommt den Verweis auf die
  Ausnahme.
- `src/AGENTS.md`, Abschnitt „Ausgang an Menschen“, bekommt Kanäle, Zustand „zugestellt“ und
  Faxfehler.
- Arc42: 05 (PDF-Baustein, Adapter-Art), 06 (Ablauf Fax mit Nachfragen), 08 (Konzept Ausgang),
  12 (Glossar „zugestellt“).
- Anwenderdoku: `docs/anwender/kapitel/anbindungen.md` (sipgate einrichten, Token-Scopes,
  Faxline-ID finden) und das Kapitel zum Senden (Fax wählen, „zugestellt“).
- Konzept E8 auf „entschieden: Server, LLH-2095“ setzen.
- Die neue Rust-Abhängigkeit muss durch die Advisory- und Lizenzprüfung (`scripts/AGENTS.md`).

## Tests (Kern)

- Property-Test `normalize_fax`: E.164 bleibt unverändert, nationale Form mit `0` wird `+49…`,
  Müll wird abgelehnt.
- PDF:
  - ist gültig, und die Seitenzahl stimmt bei Text plus n Anlagen
  - Text mit Umlauten ist enthalten (Text-Extraktion im Test oder Suche im Content-Stream)
  - ÜBUNG erscheint nur bei einer Übung
  - die Grenze greift
  - die Ausgabe ist deterministisch
- Lauf mit Fax-Doppelgänger:
  - wartet → uebergeben → zugestellt (`SENT`)
  - → fehlgeschlagen (`FAILED`)
  - 402 → `anbindung_fehler`
  - 503 → Backoff
  - Abbruch nach dem Körper → `ungewiss` ohne zweiten Sendeaufruf
  - 2-h-Frist
  - ETB erst beim Endstand
- E-Mail: Die Mail hat jetzt einen PDF-Anhang. Bestehende Tests ziehen nach.
- Routen: Fax-Adresse anlegen oder ablehnen, Senden an Fax ohne Anbindung ergibt
  `anbindung_fehlt`, Matrix und Threema bleiben gesperrt.
- e2e: Faxnummer an einer Stelle anlegen, Lagebericht per Fax senden, Versandliste zeigt
  „zugestellt“ (Doppelgänger).

## Offen für den Builder

- Die genaue PDF-Bibliothek, sofern sie die Bedingungen erfüllt: reines Rust, MIT/Apache,
  Schrift einbettbar, PNG einbettbar. Textbreiten können über `ttf-parser` gemessen werden, falls
  die Bibliothek das nicht selbst kann.
- Den sipgate-Endpunkt für „Verbindung prüfen“ und die Größengrenze von sipgate aus
  `https://api.sipgate.com/v2/doc` übernehmen. Der Host `developer.sipgate.io` war aus dieser
  Sitzung nicht erreichbar.
- Ob die Abfrage-Taktung (30 s, dann 60 s) eigene Konstanten in `zustand.rs` bekommt.
- Die Aufteilung der Migration (ein Umbau für `ausgang`) nach `migrations/AGENTS.md`.
