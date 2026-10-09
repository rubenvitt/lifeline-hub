# Betrieb: Logs, Request-Kontext und Auth-Audit

## Request-Log

Jeder HTTP-Request läuft in einem `tracing`-Span mit **Methode, Pfad und Request-ID**.
Damit ist jede Logzeile, die während der Bearbeitung entsteht, dem Endpunkt und dem
konkreten Aufruf zuzuordnen — vorher war ein „Datenbankfehler" im Log eine Meldung ohne
Absender.

Der Gewinn steckt genau darin, dass `src/error.rs` **nicht** angefasst werden musste: die
dortigen `tracing::error!`-Zeilen erben den Kontext vom Span, in dem sie laufen.

Die Request-ID (`x-request-id`) wird gesetzt, wenn der Client keine mitschickt, und in die
Antwort gespiegelt. Meldet jemand einen Fehler, ist die ID aus seiner Antwort der direkte
Weg zu den passenden Logzeilen.

### Schutz vor Log-Flut (LFH-925)

Methode, Pfad und Request-ID hängen an jeder Logzeile eines Requests, und mehrere Zeilen
entstehen ohne Anmeldung. Ohne Schranken könnte ein Fremder im Netz der Führungsstelle das
Journal fluten; journald verwirft dann für den Rest des Intervalls **alle** Meldungen des
Dienstes, auch Backup-, Purge- und DB-Fehler.

- **Request-ID des Clients:** übernommen wird sie nur mit 1 bis 64 Zeichen aus
  `[A-Za-z0-9-]` (eine UUID passt) und nur einmal gesendet. Jede andere ersetzt der Server
  durch eine eigene UUID, in Log und Antwort.
- **Pfad:** im Span höchstens 256 Zeichen, gekürzt mit `…`.
- **Kopfgröße:** HTTP/1-Köpfe über 32 KiB weist der Server mit `431` ab, bevor ein Handler
  läuft (`verbindung::HTTP1_MAX_KOPF`). HTTP/2 begrenzt die Kopfliste ohnehin auf 16 KiB.
- **Gesperrte Quelle bei der Anmeldung:** „Anmeldeversuch abgewiesen“ bzw. „Zweitfaktor
  abgewiesen“ steht höchstens einmal je Quelle und Minute im Log; das Feld `ungemeldet`
  nennt die seit der letzten Zeile still abgewiesenen. Jeder Versuch bleibt in `auth_audit`.
- **Überlast als Sammelzeile:** Lastabwurf („Zulassungsgrenze erreicht“), erschöpfter
  Verbindungspool, Schreibkonflikt und 503-Antworten im `TraceLayer` schreiben höchstens eine
  WARN-Zeile je Minute. Die erste kommt sofort, die nächste trägt `anzahl` (Ereignisse seit der
  letzten Zeile) und `seit_s`. Ebbt die Last ab, steht der Rest der Zählung erst in der Zeile
  des nächsten Ereignisses.
- **503 ist kein ERROR mehr:** der `TraceLayer` schreibt einen 503 als WARN-Sammelzeile; jeder
  andere 5xx bleibt eine ERROR-Zeile („response failed“).
- **Nicht blockierend:** ein eigener Thread schreibt das Log auf stdout. Staut journald, fallen
  Zeilen aus dem Puffer (16 Ki Zeilen) weg, statt dass ein Tokio-Worker hängt.

Wer eine neue Logzeile auf einem Weg ohne Anmeldung einführt, die je Anfrage entstehen kann,
drosselt sie mit `log_drossel::Sammelzeile`.

Log-Level steuern (Standard `info`):

```bash
RUST_LOG=debug ./lifeline-hub …
RUST_LOG=lifeline_hub=debug,tower_http=debug ./lifeline-hub …
```

> Der `TraceLayer` liegt **außerhalb** des CatchPanic-Layers und sieht deshalb auch die
> abgefederten Panik-500er.

## Auth-Audit-Spur

Anmelde-Ereignisse landen **zusätzlich zum Log** in der Tabelle `auth_audit` — nur so sind
sie revisionssicher, im Backup enthalten und auswertbar (in der Verwaltung, siehe
„Zugangsprotokoll in der Verwaltung“). Protokolliert werden:

| Ereignis | Wann | Benutzername |
|---|---|---|
| `login_ok` | erfolgreiche Anmeldung **mit Session** | der angemeldete Benutzer |
| `login_fehlgeschlagen` | falsches Passwort, unbekannter Benutzer, gesperrte Quelle | der **versuchte** Name (muss keinem Benutzer entsprechen) |
| `logout` | Abmeldung | — (nur `benutzer_id`) |
| `passwort_geaendert` | Passwort selbst gewechselt (`POST /api/auth/passwort`), nach dem Speichern | der angemeldete Benutzer (mit `benutzer_id`) |
| `passwort_wechsel_abgewiesen` | Passwortwechsel mit falschem Alt-Passwort | der angemeldete Benutzer (mit `benutzer_id`) |

Beim Passwortwechsel schreibt nur die Prüfung des Alt-Passworts eine Zeile. Formfehler (`400`),
ein abgeschalteter Passwort-Provider (`403`) und eine gesperrte Quelle (`429`) protokollieren
nichts: dort wurde kein Passwort geprüft (LFH-827).

Bei aktivem TOTP gibt es **kein** `login_ok` nach dem Passwort-Schritt: solange der
Zweitfaktor aussteht, ist niemand angemeldet.

Beispielabfragen:

```sql
-- Fehlversuche der letzten Stunde, nach Quelle
SELECT peer_ip, COUNT(*) FROM auth_audit
WHERE ereignis = 'login_fehlgeschlagen' AND zeitpunkt > datetime('now', '-1 hour')
GROUP BY peer_ip ORDER BY COUNT(*) DESC;

-- Wer hat wann von wo das Passwort geändert oder es versucht?
SELECT zeitpunkt, ereignis, benutzername, peer_ip FROM auth_audit
WHERE ereignis IN ('passwort_geaendert', 'passwort_wechsel_abgewiesen')
ORDER BY zeitpunkt DESC;

-- Wer war heute angemeldet?
SELECT zeitpunkt, benutzername, peer_ip FROM auth_audit
WHERE ereignis = 'login_ok' AND zeitpunkt > datetime('now', 'start of day');
```

**Aufbewahrung:** 90 Tage (`auth::audit::AUFBEWAHRUNG_TAGE`). Die Spur enthält
personenbezogene Daten, hängt aber an keinem Einsatz und damit an keiner
Einsatz-Aufbewahrungsfrist — sie braucht deshalb eine eigene. Durchgesetzt wird sie als
Phase C im Purge-Scheduler, der ohnehin läuft.

**Ein Schreibfehler bricht die Anmeldung nicht.** Bewusst so: einen Login im Einsatz zu
verweigern, weil die Audit-Tabelle klemmt, wäre der schlechtere Ausgang. Die Lücke bleibt
über einen `error!` im Log sichtbar.

## Admin-Spur

Was ein Admin am Zugang ändert, steht in der Tabelle `admin_audit` (LFH-1005): Konto angelegt,
deaktiviert, reaktiviert, Rolle geändert, Zweitfaktor zurückgesetzt, Anmeldeweg geschaltet. Jede
Zeile nennt Zeitpunkt, handelnde Person (Benutzername als Schnappschuss), Zielkonto oder
Anmeldeweg, bei Bedarf ein Detail (Rollen alt → neu) und die Quell-IP. Geschrieben wird nach der
Aktion; ein Schreibfehler hält sie nicht auf. **Aufbewahrung:** 365 Tage
(`auth::admin_audit::AUFBEWAHRUNG_TAGE`), Phase C im Purge-Scheduler.

## Zugangsprotokoll in der Verwaltung

Beide Spuren liest der System-Admin unter **Verwaltung → Zugangsprotokoll** (LFH-1097), ohne
Datenbankzugriff: Reiter „Zugangsänderungen“ (Admin-Spur) und „Anmeldungen“ (Anmeldespur), Filter
nach Zeitraum, Konto und Ereignis bzw. Aktion, neueste zuerst. Dahinter stehen
`GET /api/zugangsprotokoll/zugangsaenderungen` und `GET /api/zugangsprotokoll/anmeldungen`
(Parameter `von`, `bis`, `konto`, `aktion` bzw. `ereignis`, `vor_id`, `limit`). Andere Rollen
bekommen `403`. Der Kontofilter vergleicht ohne Groß-/Kleinschreibung und trifft in der Admin-Spur
die handelnde Person und das Zielkonto. **Das Lesen schreibt keine Spur.**

**Prüfpunkte für den Betreiber (keine Rechtsberatung).** Die Spuren sind personenbezogen, die
Admin-Spur ist ein Protokoll über Handlungen von Personen mit Admin-Rechten. Vor Inbetriebnahme
klärt der Betreiber mit seinem Datenschutzbeauftragten und gegebenenfalls der Interessenvertretung:

1. **Rechtsgrundlage und Zweck:** Sind die Admins Beschäftigte, gelten der
   Beschäftigtendatenschutz (§ 26 BDSG bzw. Landesrecht) und die Zweckbindung; bei Ehrenamtlichen
   die DSGVO allgemein. Zweck ist der Nachweis von Zugangsänderungen und Anmeldeversuchen, keine
   Leistungs- oder Verhaltenskontrolle.
2. **Speicherdauer:** Ob 365 Tage (Admin-Spur) und 90 Tage (Anmeldespur) verhältnismäßig sind
   (Art. 5 Abs. 1 lit. e DSGVO). Die Begründung der Werte steht an den Konstanten; andere Fristen
   brauchen heute eine Codeänderung.
3. **Mitbestimmung:** Eine technische Einrichtung, die objektiv geeignet ist, Verhalten oder
   Leistung zu überwachen, ist in der Regel mitbestimmungspflichtig (§ 87 Abs. 1 Nr. 6 BetrVG, im
   öffentlichen Dienst die Personalvertretungsgesetze). Das betrifft schon das Aufzeichnen; die
   Ansicht macht die Auswertung nur leichter.
4. **Kreis der Lesenden:** Nur System-Admins lesen; sie sind zugleich die Gruppe, deren Handlungen
   die Admin-Spur festhält. Wer das Lesen selbst protokolliert haben will, braucht eine Änderung.

## Anmelde-Bremse

Nach **10 Fehlversuchen aus derselben Quell-IP innerhalb von 5 Minuten** antwortet
`POST /api/auth/login` mit `429`. Die Sperre läuft von selbst aus; es gibt keine dauerhafte
Blockliste.

Bewusst großzügig: eine ganze Wache kann hinter einer NAT-Adresse hängen, und ein
Aussperren im Einsatz ist ein echter Betriebsschaden. Zwei Sicherungen dagegen:

- Nur **Fehlversuche** zählen.
- Eine **erfolgreiche Anmeldung räumt die Fehlversuche gegen das eigene Konto** — wer
  sich vertippt und dann anmeldet, bringt die Quelle nicht näher an die Sperre.

Versuche gegen **andere** Konten räumt der Erfolg nicht (LFH-793): sonst setzte jemand die
Sperre nach neun fremden Passwörtern mit dem eigenen Konto zurück. Eine Sperre je Konto über
alle Quellen gibt es bewusst nicht; sie sperrte ein Konto für jeden, der seinen Namen kennt.

Der Zähler liegt im Prozessspeicher und ist nach einem Neustart leer. Für den Zweck
(automatisiertes Raten ausbremsen) reicht das; die dauerhafte Spur liegt in `auth_audit`.
Die Tabelle ist begrenzt: ab 1 024 Quellen räumt ein neuer Eintrag die abgelaufenen weg
(höchstens einmal je Sekunde), bei 10 000 verdrängt er die Quellen mit dem ältesten letzten
Versuch auf 9 000. Je Quelle bleiben die ältesten zehn Versuche, damit ein Schwall eigener
Fehlversuche die fremden nicht verdrängt.

Die Quell-IP ist die **Socket-Adresse**. `X-Forwarded-For` wird nur ausgewertet, wenn
die Gegenstelle ein ausdrücklich genannter Proxy ist (`LIFELINE_TRUSTED_PROXIES`, LFH-604;
Einzelheiten in `docs/betrieb/env-registry.md`): von jeder anderen Gegenstelle ist der
Header frei fälschbar, und ein fälschbares Rate-Limit ist keins. **Hinter einem
Reverse-Proxy muss die Liste gesetzt sein** — sonst sieht der Server nur die Proxy-IP, und
zehn Fehlversuche von beliebiger Seite sperren den Passwort-Login für alle. Dieselbe
Quell-IP gilt für Passwortwechsel, App-Code-Einlösung und `auth_audit`.
