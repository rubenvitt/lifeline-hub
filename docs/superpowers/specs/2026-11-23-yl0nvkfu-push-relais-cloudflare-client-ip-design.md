# Push-Relais hinter Cloudflare: echte Client-Adresse (LLH-2080)

Zunder: https://zunder.rubeen.dev/#/aufgabe/yl0nvkfufmblhseov80bcql0

Kurzer Entwurf (kleine Änderung). Route `entwurf` wegen E2: die Regel „genau ein Proxy, rechter
`X-Forwarded-For`-Eintrag“ in `push-relais/AGENTS.md` ändert sich.

## Anlass und Ziel

`push.rubeen.dev` und `lifeline-hub.rubeen.dev` laufen über Cloudflare (orange) vor Traefik auf
r-server. Traefik hat kein `forwardedHeaders.trustedIPs`, verwirft also das `X-Forwarded-For`
von Cloudflare und setzt die Edge-Adresse ein. Folge:

- Das Relais (`push-relais/src/api.rs`, `client_ip`) nimmt den rechten Eintrag, die
  Registrierungsgrenze (10 je IP und Stunde) zählt Cloudflare-Knoten statt Clients.
- Der Hauptserver (`src/extract.rs`, `client_ip`, LFH-604) geht von rechts, die Edge-Adresse
  liegt nicht in `LIFELINE_TRUSTED_PROXIES=10.0.1.0/24` und gilt als Client. Anmelde-Bremse
  (zehn Fehlversuche, fünf Minuten) und Passkey-/SSO-Drossel treffen damit alle, die über
  denselben Knoten kommen.

Ziel: Beide Dienste zählen die öffentliche Adresse des Clients. Die Origin-IP von r-server bleibt
hinter Cloudflare verborgen.

**Nicht-Ziele:** Cloudflare-Bereiche im Code pflegen oder automatisch laden; Traefik-Plugins;
`CF-Connecting-IP` auswerten; die Client-Adresse ins Relais-Log schreiben (das Log trägt weiter
nur `server_id`, Zähler und Fehlerarten).

**Anti-Ziel:** Ein Weg, auf dem ein Client seine Adresse selbst wählt, etwa weil das Relais einem
Header traut, ohne dass die Gegenstelle ein bekannter Proxy ist.

## Ansätze

| Weg | Was | Abwägung |
| --- | --- | --- |
| **B — Cloudflare als vertraute Proxys (gewählt)** | Traefik vertraut den Cloudflare-Bereichen (`forwardedHeaders.trustedIPs`) und hängt die Edge-Adresse an das erhaltene `X-Forwarded-For` an. Relais und Hauptserver gehen von rechts und überspringen vertraute Einträge. | Origin bleibt verborgen; der Hauptserver kann es schon, das Relais braucht eine Proxy-Liste statt des Schalters. Die Cloudflare-Liste ist von Hand zu pflegen (ändert sich selten). |
| A — „DNS only“ | Beide Namen in Cloudflare grau schalten, Traefik ist einziger Proxy. | Kein Code. Legt aber die Adresse von r-server offen, damit für alle Dienste dort, und nimmt den Cloudflare-Schutz. Verworfen. |
| C — `CF-Connecting-IP` per Plugin | Ein Traefik-Plugin schreibt `CF-Connecting-IP` als einzigen XFF-Eintrag. | Kein Code im Relais, aber ein Fremd-Plugin in Traefik zu pflegen. Verworfen. |

Gewählt am 23.11.2026 (Ruben), dazu: die Cloudflare-Liste steht nur in der Betriebsdoku.

## Entwurf

**Relais — Proxy-Liste statt Schalter.**

- Neue Variable `PUSH_RELAIS_TRUSTED_PROXIES` (`--trusted-proxies`) in `push-relais/src/config.rs`:
  Komma-Liste aus CIDR-Netzen und Einzeladressen, dieselben Regeln wie `LIFELINE_TRUSTED_PROXIES`
  (Hostname, leerer Eintrag, IPv4-gemapptes Netz → Start bricht ab). Name wie beim Hauptserver,
  damit Betreiber eine Regel für beide lernen.
- `client_ip` im Relais folgt `src/extract.rs::client_ip`: liegt die Gegenstelle nicht in der
  Liste, gilt sie; sonst `X-Forwarded-For` von rechts, der erste Eintrag außerhalb der Liste ist
  der Client; ein unlesbarer Eintrag beendet die Suche bei der letzten Stufe; IPv4-gemappte
  Adressen zählen als IPv4. Die Funktion wird ins Relais kopiert (eigenes Paket, keine
  Abhängigkeit auf das Hauptpaket), `ipnet` kommt als Abhängigkeit dazu.
- `PUSH_RELAIS_HINTER_PROXY` bleibt mit unveränderter Bedeutung (genau ein Proxy, rechter
  Eintrag) für Betreiber ohne CDN. **Beide gesetzt → der Start bricht ab** mit Hinweis, nur die
  Liste zu nutzen. *(Meine Wahl: eindeutiger als stillschweigender Vorrang.)*

**Hauptserver — nur Konfiguration.** Kein Code. Auf r-server
`LIFELINE_TRUSTED_PROXIES=10.0.1.0/24,<Cloudflare-Bereiche>`.

**r-server (Ruben, außerhalb des Repos).**

- Traefik: `--entrypoints.<websecure>.forwardedHeaders.trustedIPs=<Cloudflare-Bereiche>`.
  Kommt eine Anfrage von dort, bleibt das `X-Forwarded-For` von Cloudflare (`<client>`) erhalten
  und Traefik hängt die Edge-Adresse an: `<client>, <edge>`. Eine Anfrage direkt an den Origin
  verliert ihr mitgeschicktes `X-Forwarded-For` wie bisher und trägt nur die eigene Adresse.
- Relais: `PUSH_RELAIS_HINTER_PROXY` entfernen, `PUSH_RELAIS_TRUSTED_PROXIES=<Netz von Traefik
  zum Relais>,<Cloudflare-Bereiche>`.

**Doku.**

- `docs/betrieb/push-relais.md`: Variable in der Tabelle, Abschnitt „Hinter einem CDN
  (r-server: Cloudflare)“ mit der gewählten Lösung, der Cloudflare-Liste samt Quelle
  (`https://www.cloudflare.com/ips/`) und Stand, den Traefik-Args und beiden Umgebungen; die
  Ein-Proxy-Warnung verweist darauf.
- `push-relais/AGENTS.md`: die Regel zur Client-IP auf die Liste umstellen.
- `docs/betrieb/env-registry.md` (`LIFELINE_TRUSTED_PROXIES`): ein Satz zum CDN mit Verweis.
- `docs/architektur/07-verteilungssicht.md`: Zeile `push-relais` nennt die neue Variable.

**Nachweis (Akzeptanzkriterium).** Integrationstest in `push-relais/tests/registrierung.rs`:
Gegenstelle im Docker-Netz, Liste = Docker-Netz + ein Cloudflare-Bereich, `X-Forwarded-For:
<gefälscht>, <client>, <edge>` → gezählt wird `<client>`; ein zweiter Client über dieselbe Edge
ist unberührt; eine Gegenstelle außerhalb der Liste zählt selbst, ihr Header nicht. Dazu Tests für
den Konfigurationsabbruch (beide gesetzt, Hostname in der Liste).

## Dem Bauenden überlassen

Fehlertexte, Testnamen, genaue Gliederung der Doku-Abschnitte; ob Tests für `client_ip` als
Unit-Tests im Relais oder nur als Integrationstests laufen.
