# Tasks

Zunder: https://zunder.rubeen.dev/#/aufgabe/b1tfx66djmhy80rchxkgwwd8 (LLH-1168). Jede Aufgabe
entsteht testgetrieben (`superpowers:test-driven-development`).

## 1. Backend: Einsatzleiter an der Einsatzanzeige (D1–D3)

- [x] 1.1 Umformung der vier Spalten samt `personal_noch_disponiert` als eine Funktion in
  `src/einsatz/fuehrungsstelle.rs` herausziehen, `load_tx` ruft sie; belegt durch die
  bestehenden Tests in `tests/einsatz_fuehrungsstelle.rs` (grün, unverändert)
- [x] 1.2 `EinsatzAnzeige.einsatzleiter: Option<EinsatzleiterAnzeige>` (`skip_serializing_if`)
  einführen; `Einsatz` trägt die Rohspalten, `repo::laden` und `repo::liste_fuer` holen sie über
  LEFT JOIN auf `einsatz_fuehrungsstelle` und `einsatz_personal`, `Einsatz::anzeige` und die Liste
  rufen die Umformung aus 1.1; Integrationstest: Liste und Detail tragen „Anna Schulz“ mit `seit`,
  ohne Einsatzleiter fehlt der Schlüssel (`contains_key`), App-Rolle Einsatzleitung allein ergibt
  kein Feld, eine entlassene Person trägt `personal_noch_disponiert: false`
- [x] 1.3 Schwärzung auf Antrag des Einsatzleiters: Integrationstest, dass die Liste danach den
  Einsatzleiter ohne `name` liefert und „Anna Schulz“ nicht im Antworttext steht
- [x] 1.4 `lage_snapshot::erzeuge` setzt `einsatzleiter` auf `None` (D2); Test: Snapshot eines
  Einsatzes mit Einsatzleiter enthält in `daten.einsatz` keinen Schlüssel `einsatzleiter`
- [x] 1.5 `ohne_kopf_pii_wenn_gesperrt` nimmt `einsatzleiter` heraus (D3); Test am Frist-PUT
  eines gesperrten Einsatzes neben den übrigen Kopf-PII
- [x] 1.6 `scripts/check-typ-codegen.sh` laufen lassen und `frontend/src/api/openapi.json` sowie
  `frontend/src/api/types.generated.ts` mitcommitten; das Skript ist danach grün

## 2. Frontend: eine Darstellung aus der Angabe (D5)

- [x] 2.1 `einsatzleiterAusAngabe` in `frontend/src/stab/einsatzleiter.ts`, `einsatzleiterDarstellung`
  ruft sie; Vitest in `stab/einsatzleiter.test.ts`: erfasst, nicht erfasst (`null`/`undefined`),
  geschwärzt („Name geschwärzt“), extern („(extern)“), „nicht mehr disponiert“

## 3. Kommunikationsplan: Einsatzleiter im Nebentext der Zeile `fs`

- [x] 3.1 `fuehrungsstelleZeile` in `stab/kommunikationsplan.ts` setzt den Nebentext aus Rufname
  und „Einsatzleiter …“ über `einsatzleiterKurz`; Vitest in `stab/kommunikationsplan.test.ts` für
  die Szenarien der Delta-Spec `stab-kommunikationsplan` (mit/ohne Rufname, nicht erfasst,
  geschwärzt, fehlende Quelle nur mit Grund) und Abwesenheit eines App-Rollen-Namens
- [x] 3.2 Seitentest des Kommunikationsplans (Schirm und Druckform) zeigt den Nebentext der Zeile
  „Führungsstelle“ mit Einsatzleiter
- [x] 3.3 `frontend/src/stab/AGENTS.md`, Abschnitte „Einsatzleiter“ und „Kommunikationsplan S6“:
  den Kommunikationsplan als Anzeigestelle nennen; Prettier über `frontend/` grün

## 4. Einsatzliste: Zeile „EL …“ in jeder Kachel

- [x] 4.1 `renderKarte` in `pages/EinsaetzePage.tsx` zeigt `<abbr title="Einsatzleiter">EL</abbr>`
  und `einsatzleiterKurz(einsatzleiterAusAngabe(e.einsatzleiter))`, aktiv wie abgeschlossen;
  Seitentest: „EL Anna Schulz“, „EL KBM Weber (extern)“, „EL nicht erfasst“ trotz App-Rolle,
  „EL Name geschwärzt“
- [x] 4.2 Live: Seitentest oder bestehender Live-Test belegt, dass ein Ereignis `einsatzliste`
  die Kachel ohne Neuladen auf den neuen Einsatzleiter zieht (Szenario „Wechsel auf einem anderen
  Schirm“), sonst Backend-Test, dass der PATCH des Einsatzleiters `einsatzliste` meldet

## 5. Anwenderdokumentation (Mitänderungsregel)

- [x] 5.1 `docs/anwender/kapitel/einsatz-oberflaeche.md`: die Kachel nennt den Einsatzleiter
  („EL …“); Bilder `pnpm doku:bilder e2e/doku-bilder/einsatz-oberflaeche.bilder.ts` neu erzeugen
  und committen; Wächter `hilfe/anwenderdoku.guard.test.ts` grün
- [x] 5.2 `docs/anwender/kapitel/funkplan.md`, Abschnitt Kommunikationsplan: Zeile
  „Führungsstelle“ nennt Rufname und Einsatzleiter; Bilder
  `pnpm doku:bilder e2e/doku-bilder/funkplan.bilder.ts` neu erzeugen und committen; Wächter grün

## 6. Abschluss

- [ ] 6.1 `./scripts/check-all.sh` grün (bei Umgebungsgrenzen der Cloud-Sitzung: die betroffenen
  Bündel einzeln, Rest belegt die CI des PRs)

## Workflow follow-up

- Review (`superpowers:requesting-code-review`), dann `/opsx:archive` im selben Branch vor dem PR.
- PR gegen `alpha` mit Zeile `Zunder: https://zunder.rubeen.dev/#/aufgabe/b1tfx66djmhy80rchxkgwwd8`.
