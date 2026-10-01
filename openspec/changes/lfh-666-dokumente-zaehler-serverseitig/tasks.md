# Tasks

## 1. Backend: Dokumente zählen (D1, D4)

- [x] 1.1 Integrationstest in `tests/modul_zaehler.rs` zuerst (rot): 3 Dokumente über
      `POST …/dokumente` ablegen, eines über `DELETE` entfernen → `dokumente.gesamt == 2` und
      gleich der Länge von `GET …/dokumente`. Prüfung: `cargo test --test modul_zaehler` rot,
      weil das Feld fehlt
- [x] 1.2 `ModulZaehlerAnzeige` um `dokumente: Option<MengenZaehler>` erweitern
      (`skip_serializing_if`) und in `berechne` hinter `erlaubt.contains("dokumente")` mit
      `COUNT(*) … WHERE einsatz_id = ? AND geloescht_at IS NULL` füllen. Ein Kommentar verweist
      auf das Prädikat von `dokument::repo::liste`, der Modulkopf nennt die Dokumente.
      Unit-Test `jedes_feld_ist_ein_modul_key` auf 9 Felder heben. Prüfung: 1.1 grün,
      `cargo test --lib einsatz::zaehler` grün
- [x] 1.3 Gating-Tests ergänzen: `ausgeblendetes_modul_fehlt_statt_null` (bzw. ein eigener
      Fall) für `dokumente`, `erlaubtes_leeres_modul_steht_auf_null` deckt `dokumente.gesamt == 0`
      ab. Prüfung: `cargo test --test modul_zaehler` grün; Mutationsprobe: das Gate
      `erlaubt.contains("dokumente")` entfernen → der Ausblende-Test wird rot
- [x] 1.4 Typ-Codegen: `scripts/check-typ-codegen.sh` ausführen und beide generierten Dateien
      mitcommitten. Prüfung: das Skript läuft ohne Diff durch, `ModulZaehler` im Frontend hat
      `dokumente?: MengenZaehler`

## 2. Frontend: Serverquelle statt Browser-Zähler (D2, D3)

- [x] 2.1 Tests zuerst (rot): `useModulZaehler.test.ts` prüft `bildeZaehler({ dokumente:
      { gesamt: 3 } })` → „3 abgelegte Dokumente“ und `{ gesamt: 1 }` → „1 abgelegtes Dokument“
      (statt `berechneDokumentZaehler`). `useModulZaehler.hook.test.tsx` erwartet drei
      Anfragen ohne `/api/einsaetze/7/dokumente`. `queryKeys.test.ts` nimmt `'dokument'` in die
      Gegenprobe auf. Prüfung: die drei Dateien laufen rot
- [x] 2.2 `modulRegistry.ts`: `'dokumente'` von `ClientZaehlerQuelle` nach
      `ServerZaehlerQuelle` verschieben und den Doc-Kommentar der Client-Quellen anpassen.
      `useModulZaehler.ts`: `ABBILDUNG.dokumente` und `ZAEHLER_LISTEN_KEYS.dokumente =
      EINSATZ_KEYS.dokumente` anlegen; Dokumentabfrage, `dokumenteAktiv`,
      `berechneDokumentZaehler` und den Import `listeDokumente` entfernen. Prüfung: Typcheck
      grün, Tests aus 2.1 für Abbildung und Hook grün
- [x] 2.3 `queryKeys.ts`: `EINSATZ_STREAM_EVENTS.dokument` um `EINSATZ_KEYS.modulZaehler`
      ergänzen. Prüfung: `queryKeys.test.ts` grün; Mutationsprobe: Eintrag wieder entfernen →
      die Vollständigkeitsprüfung wird rot
- [x] 2.4 Restverweise suchen (`grep -rn "berechneDokumentZaehler\|ClientZaehlerQuelle"
      frontend/src`) und Kommentare nachziehen, die Dokumente noch als Browser-Zähler nennen.
      Prüfung: grep ohne veraltete Treffer, Lint grün. Nachgezogen: die Modulzähler-Regel in
      `frontend/src/etb/AGENTS.md` nennt Dokumente und die zwei verbliebenen Browser-Zähler

## 3. Integration

- [ ] 3.1 `./scripts/check-all.sh` grün (nach `git fetch origin alpha` für die
      Migrationsprüfung). Prüfung: Exit 0, ohne `| tail`
- [ ] 3.2 Sichtprüfung gegen ein echtes Backend mit Vite-Dev-Server: Einsatz mit 2 Dokumenten
      → Modul „Dokumente“ zeigt 2 mit „2 abgelegte Dokumente“; im Netzwerk-Tab keine Anfrage
      an `…/dokumente`, solange die Dokumentenseite nicht offen ist; ein drittes Dokument per
      API ablegen → Zähler steigt ohne Reload auf 3. Ist kein Browser verfügbar, wird das
      vermerkt und durch die Hook- und Integrationstests belegt
