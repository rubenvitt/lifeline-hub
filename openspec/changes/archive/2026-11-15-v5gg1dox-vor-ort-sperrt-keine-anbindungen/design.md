# Design

## Context

Die Sperre für Fremdsysteme hängt an einer einzigen Abfrage, `public_api::zugang::hub_fuer_org`.
Sie prüft Richtung `meldet_sich`, Zustand `aktiv` und eine nicht widerrufene Zuordnung der Org,
nicht aber die Art der Kopplung. Aufrufer sind der Extractor des Maschinenzugangs
(`public_api/machine.rs`), Anlegen und Code ausstellen (`public_api/routen.rs`), der Einwurf
(`public_api/einwurf/routen.rs`), das Freigabe-Paneel (`public_api/freigabe.rs`,
`is_org_am_hub`) und der Sperrgrund der Seite „Anbindungen“ (`routes/anbindungen.rs`,
`gesperrt_grund`). Was eine Kopplung trägt, regelt seit LLH-1497 die Art: `standard` alles,
`vor_ort` keinen Hub-Fluss (`InstanzKopplungArt::traegt`, `src/AGENTS.md`, „Direktkopplung vor
Ort“). Motivation: proposal.md, „Why“.

## Goals / Non-Goals

**Goals:**

- Eine Stelle entscheidet, ob die Org am Hub hängt; alle Aufrufer folgen ihr ohne eigene Änderung.
- Ein Rückfall (Filter fällt beim Umbau der Abfrage weg) wird rot.

**Non-Goals:**

- Kein neuer `Fluss` und keine Änderung an `InstanzKopplungArt::traegt` (abgestimmt am
  15.11.2026).
- Keine Änderung an den Freigaben gespiegelter Einsätze: Ein Spiegel über eine Direktkopplung
  folgt denselben Regeln wie ein Spiegel am Hub (Spec `maschinenzugang`, Freigabe-Anforderungen).
- Kein Wire-, OpenAPI- oder Frontend-Wechsel; `gesperrt_grund` bleibt, wie er ist.

## Decisions

### D1 Filter in der SQL-Abfrage

`hub_fuer_org` bekommt `AND k.art = 'standard'`, in der Schreibweise, die schon
`stammdaten/herkunft.rs`, `stammdaten/geheimnis.rs` und `einsatz/archiv.rs` nutzen
(`src/AGENTS.md`: „in SQL `k.art = 'standard'`“).

- *Alternative:* Zeilen laden und in Rust über die Art filtern. Mehr Code für dieselbe Aussage,
  und `LIMIT 1` müsste fallen, weil eine `vor_ort`-Zeile sonst die Standardzeile verdecken könnte.
- *Alternative:* eigener `Fluss::Anbindungen` mit `traegt`. Verworfen am Checkpoint: Fremdsysteme
  fließen nicht über die Kopplung, die Frage ist nur, ob ein Hub zuständig ist.

### D2 Gemischte Lage nennt den Hub

Weil der Filter vor `ORDER BY k.id LIMIT 1` greift, liefert die Abfrage bei einer Direktkopplung
und einer Standardkopplung derselben Org immer die Standardkopplung. Der Sperrgrund nennt damit
den Hub, nicht den zweiten ELW (Szenario „Hub und Direktkopplung zugleich“).

### D3 Wächter

`src/public_api/zugang.rs` mit der Nadel `k.art = 'standard'` kommt in
`instanz::art_tests::jeder_fluss_hat_seine_pruefstellen`. Der Wächter zählt damit auch diese
Stelle; der Kommentar dort nennt sie als Prüfung „Hub zuständig für Fremdsysteme“, nicht als
Fluss.

### D4 Tests

- Repo-Test in `zugang.rs`: nur `vor_ort` → `None`; nur `standard` → Hub; beide → der Hub.
- `tests/maschinenzugang.rs`: Org nur `vor_ort` gekoppelt → signierte Anfrage 200, Liste ohne
  `gesperrt_grund`, Anlegen 201; der bestehende Test mit `standard` bleibt 401.
- `tests/einwurf.rs`: Org nur `vor_ort` gekoppelt → Einwurf angenommen, Paneel ohne Sperrgrund,
  Anlegen und Schlüsselwechsel möglich; der bestehende Test mit `standard` bleibt.

Die Hilfen, die heute eine Kopplung einfügen, bekommen die Art als Parameter, statt eine zweite
Kopie des Inserts zu tragen.

## Risks / Trade-offs

- [Ruhende Freigaben werden wirksam] Eine Instanz, die heute nur `vor_ort` gekoppelt ist, hat
  ruhende Freigaben, die mit dem Update wieder gelten. → Gewollt: Die Spec nennt die Sperre nur
  für einen Hub; die Einsatzleitung sieht und beendet Freigaben im Paneel wie sonst.
- [Neue Kopplungsart später] Kommt eine dritte Art hinzu, sperrt sie nicht, bis jemand sie in die
  Abfrage aufnimmt. → Bewusst eng: gesperrt wird nur, wo ein Hub sicher zuständig ist.
