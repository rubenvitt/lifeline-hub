---
id: ADR-0025
titel: Hinweise eines geführten Einsatzes reisen als Anlass zum Hub, der Hub pusht
status: akzeptiert
datum: 2026-11-12
gilt_fuer:
  - src/benachrichtigung/mod.rs
  - src/instanz/spiegel/hinweis.rs
  - src/instanz/spiegel/abgleich.rs
  - src/routes/web_push.rs
herleitung:
  - openspec/changes/archive/2026-11-12-lc02103g-bruecke-web-push/design.md
  - LLH-1495 (mit Ruben am 12.11.2026 abgestimmt; Entscheidung 12 aus LLH-1287)
---

# ADR-0025: Hinweise eines geführten Einsatzes reisen als Anlass zum Hub, der Hub pusht

## Regeln

- MUST: `benachrichtigung::melden` und `erledigen` merken für einen hier geführten Einsatz,
  dessen Org aktiv mit einer Instanz gekoppelt ist, die Hinweise annimmt, den Anlass vor
  (`instanz::spiegel::hinweis`). Der Anlass reist, nie die aufgelösten Empfänger: die erreichte
  Seite bestimmt sie nach ihren eigenen Regeln.
- MUST: Die erreichte Seite nimmt einen Anlass (auch „für alle erledigt“) erst an, wenn sein
  Einsatz und seine Zeilen im Spiegel stehen, höchstens einmal je Kennung und Inhalt (eine aus
  der Sicherung zurückgekehrte Gegenseite vergibt Kennungen neu), und verwirft ihn nach 12
  Stunden, mit unbekannten Werten oder als Erledigen eines Alarms.
- MUST: Eine Instanz pusht einem Empfänger nicht selbst, wenn sie den Einsatz führt, der Anlass
  vorgemerkt ist, eine solche Kopplung zusätzlich Web Push anbietet und das Konto des Empfängers
  aus ihr stammt (`hinweis::konten_am_hub`). In jedem anderen Fall pusht sie wie ohne Kopplung.
- MUST NOT: Benachrichtigungen oder Abos werden gespiegelt; jede Instanz führt ihre eigenen.
- MUST NOT: Ein neues Abo eines Kontos, dem der Hub pusht, wird angenommen; bestehende bleiben
  gespeichert.

## Prüfung

```sh
verlange 'hinweis::vormerken\(' src/benachrichtigung/mod.rs
verlange 'hinweis::vormerken_erledigt\(' src/benachrichtigung/mod.rs
verlange 'konten_am_hub' src/benachrichtigung/mod.rs
verlange 'hinweis::annehmen\(' src/instanz/spiegel/abgleich.rs
verlange 'push_hub_fuer' src/routes/web_push.rs
```

## Kontext

Ein gekoppelter ELW ist oft nur im Einsatz-LAN erreichbar; seine Abos hängen an seiner
Adresse, und ohne Internet erreicht er keinen Push-Dienst. Am Hub entstand für einen Einsatz des
ELW kein Hinweis, weil Benachrichtigungen nicht gespiegelt werden. Die Nutzlast eines Pushs
trägt nur Kennungen der sendenden Instanz, deren Text der Service Worker dort holt.

## Konsequenzen

Der Hub legt vollwertige Hinweise an (Eingang, Live, Push) und prüft dabei seine Rechte, auch
für Nutzer, die nur am Hub arbeiten. Ein Hinweis kommt am Hub erst nach dem nächsten Abgleich an
(der Ausgang weckt ihn). Wer an beiden Instanzen arbeitet, sieht den Hinweis zweimal, gepusht
wird einmal. `umadressieren` reist nicht mit; neu Gemeinte pusht die führende Instanz selbst. Ein
Konto vom Hub hat am ELW kein neues Abo und bekommt dort, wo der Hub nicht pusht, keinen Push
(hingenommen, design.md, „Risks“).
