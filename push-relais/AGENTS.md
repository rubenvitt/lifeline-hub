# push-relais (LLH-2039) — Regeln

Gilt für `push-relais/`, zusätzlich zur `AGENTS.md` der Wurzel. Der Dienst hält den Apple-`.p8`-Schlüssel
und reicht Pushes der Lifeline-Server an APNs weiter; Ruben betreibt ihn selbst (Betrieb:
`docs/betrieb/push-relais.md`). Er gehört nicht zur ausgelieferten Anwendung.

- **Das Relais kennt keine Inhalte.** Die Nutzlast ist für das Gerät verschlüsselt (AES-256-GCM, AAD
  `kennung`); das Relais reicht sie durch und liest sie nie. Kein Entschlüsseln, kein Auswerten,
  kein Zwischenspeichern.
- **Nie loggen:** Geräte-Token, `.p8`-Schlüssel, Server-Geheimnis, Nutzlast. Das Log trägt nur
  `server_id` und Zähler (`senden`) sowie Fehlerarten. Ein neues `tracing`-Feld prüft, ob es einen
  dieser Werte enthält.
- **Wire deutsch und additiv:** Felder und Werte von `/v1/server`, `/v1/senden`, `/v1/status` sind
  deutsch und danach fest; neue Felder kommen nur hinzu (`Option`/Standardwert), nichts wird
  umbenannt oder entfernt, weil ältere Lifeline-Server noch sprechen.
- **Sperren nur per Unterbefehl** (`push-relais sperren|entsperren <server_id>`): keine
  Verwaltungsroute, kein Schalter in der Umgebung. Wer die Datenbank ändert, ändert sie nicht von
  Hand.
- **Konfiguration nur in `src/config.rs`** (`PUSH_RELAIS_*`); die Betriebsdoku nennt jede Variable
  mit Standardwert, eine neue Variable steht dort im selben Commit.
- **Tests mit APNs-Doppel statt Apple:** die Basisadressen sind per Konfiguration austauschbar
  (`PUSH_RELAIS_APNS_BASIS_*`); Tests sprechen mit einem lokalen Doppel und nie mit
  `api.push.apple.com`.
- Limits (600 Nachrichten je Server und Minute, 10 Registrierungen je IP und Stunde, IPv6 je /64,
  höchstens 100 Nachrichten je `senden`-Aufruf, Körper- und Feldgrenzen, Fristen) stehen im Code
  und in der Betriebsdoku; eine Änderung zieht beide mit. Was Apple ohnehin ablehnte, weist das
  Relais vorher ab.
- **Client-IP hinter dem Proxy ist der rechte `X-Forwarded-For`-Eintrag** (`api::client_ip`):
  angenommen ist genau ein Proxy, der anhängt. Den linken Teil setzt der Client selbst; er zählt
  nie.
- **`senden` blockiert nie auf eine einzelne Nachricht:** nebenläufig über die HTTP/2-Verbindung,
  Frist je Anfrage an Apple und Gesamtfrist je Aufruf klar unter der Frist des Servers
  (`RELAIS_SENDEN_FRIST` in `src/ios_push/mod.rs`); die Ergebnisse in Eingabe-Reihenfolge.
