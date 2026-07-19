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

Log-Level steuern (Standard `info`):

```bash
RUST_LOG=debug ./lifeline-hub …
RUST_LOG=lifeline_hub=debug,tower_http=debug ./lifeline-hub …
```

> Der `TraceLayer` liegt **außerhalb** des CatchPanic-Layers und sieht deshalb auch die
> abgefederten Panik-500er.

## Auth-Audit-Spur

Anmelde-Ereignisse landen **zusätzlich zum Log** in der Tabelle `auth_audit` — nur so sind
sie revisionssicher, im Backup enthalten und auswertbar. Protokolliert werden:

| Ereignis | Wann | Benutzername |
|---|---|---|
| `login_ok` | erfolgreiche Anmeldung **mit Session** | der angemeldete Benutzer |
| `login_fehlgeschlagen` | falsches Passwort, unbekannter Benutzer, gesperrte Quelle | der **versuchte** Name (muss keinem Benutzer entsprechen) |
| `logout` | Abmeldung | — (nur `benutzer_id`) |

Bei aktivem TOTP gibt es **kein** `login_ok` nach dem Passwort-Schritt: solange der
Zweitfaktor aussteht, ist niemand angemeldet.

Beispielabfragen:

```sql
-- Fehlversuche der letzten Stunde, nach Quelle
SELECT peer_ip, COUNT(*) FROM auth_audit
WHERE ereignis = 'login_fehlgeschlagen' AND zeitpunkt > datetime('now', '-1 hour')
GROUP BY peer_ip ORDER BY COUNT(*) DESC;

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

## Anmelde-Bremse

Nach **10 Fehlversuchen aus derselben Quell-IP innerhalb von 5 Minuten** antwortet
`POST /api/auth/login` mit `429`. Die Sperre läuft von selbst aus; es gibt keine dauerhafte
Blockliste.

Bewusst großzügig: eine ganze Wache kann hinter einer NAT-Adresse hängen, und ein
Aussperren im Einsatz ist ein echter Betriebsschaden. Zwei Sicherungen dagegen:

- Nur **Fehlversuche** zählen.
- Eine **erfolgreiche Anmeldung räumt den Zähler** der Quelle — wer das Passwort kennt,
  gibt damit auch alle anderen hinter derselben IP wieder frei.

Der Zähler liegt im Prozessspeicher und ist nach einem Neustart leer. Für den Zweck
(automatisiertes Raten ausbremsen) reicht das; die dauerhafte Spur liegt in `auth_audit`.

Die Quell-IP ist die **Socket-Adresse**. `X-Forwarded-For` wird bewusst **nicht**
ausgewertet: ohne vertrauenswürdigen Reverse-Proxy ist der Header frei fälschbar, und ein
fälschbares Rate-Limit ist keins. Läuft lifeline-hub später hinter einem Proxy, muss das
bewusst und mit definiertem Vertrauensanker nachgezogen werden — sonst sieht der Server
ohnehin nur noch die Proxy-IP.
