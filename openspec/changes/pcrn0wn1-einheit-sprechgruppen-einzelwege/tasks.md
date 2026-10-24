# Tasks

## 1. Backend: ETB je wirksamer Änderung am Einzelweg der Einheit (D3)

- [ ] 1.1 Test zuerst in `tests/sprechgruppe_einzelzuordnung.rs`: Zuordnen und Lösen an der
  Einheit erzeugen je einen System-Eintrag mit dem Text aus der Spec, eine wiederholte Zuordnung
  bzw. Lösung keinen; `gleiches_live_und_keine_etb_wirkung_wie_der_patch` nimmt die Einheit aus
  dem „kein ETB“ heraus (Abschnitt, Führungsstelle, Stelle und PATCH bleiben ohne). Rot sehen mit
  `cargo test --test sprechgruppe_einzelzuordnung`.
- [ ] 1.2 `sprechgruppe_zuordnen`/`sprechgruppe_loesen` in `src/routes/einsatz_einheit.rs`
  schreiben bei Wirkung über `etb_system_degradiert`; Doc-Kommentare der beiden Handler
  berichtigen. Grün mit `cargo test --test sprechgruppe_einzelzuordnung`.
- [ ] 1.3 Integrationstest „zwei Arbeitsplätze zugleich“: zwei gleichzeitige Zuordnungen
  (`tokio::join!`) verschiedener Sprechgruppen an dieselbe Einheit, danach beide vorhanden und
  zwei ETB-Einträge. Grün mit demselben Kommando; Mutationsprobe: ETB-Aufruf auskommentieren →
  Test rot.

## 2. Frontend: Einzelwege statt ganzer Menge (D1, D2, D4)

- [ ] 2.1 `frontend/src/api/einheiten.ts`: `ordneEinheitSprechgruppeZu`/`loeseEinheitSprechgruppe`
  (PUT/DELETE, `204`); `EinheitPatch` ohne `sprechgruppe_ids`. `mise exec -- pnpm -C frontend
  typecheck` zeigt keinen übrigen Aufrufer.
- [ ] 2.2 Vitest zuerst in `EinheitFunk.test.tsx`: Hinzufügen ruft den Sprechgruppen-Handler nur
  mit dem einen hinzugefügten Eintrag (`{ hinzu: [505], weg: [] }`), Leeren mit allen als `weg`,
  kein `onPatch` mit `sprechgruppe_ids`; ein live hinzugekommener Eintrag während der Bearbeitung
  wird nicht gelöst (Diff gegen den Stand beim Öffnen). Rot sehen.
- [ ] 2.3 `EinheitFunk.tsx`: Stand beim Öffnen per `onOeffnen` in einer Ref, Diff beim Speichern,
  neuer Prop `onSprechgruppen`; Kopfkommentar berichtigen (kein „gewinnt das spätere Speichern“
  mehr). Test aus 2.2 grün.
- [ ] 2.4 `EinheitDetailPage.tsx`: Mutation sendet erst alle Lösungen, dann alle Zuordnungen,
  bricht bei der ersten Ablehnung ab, lädt danach `einheiten` (abgewartet) und `etb` neu, meldet
  „Sprechgruppen gespeichert“. Vitest in `EinheitDetailPage.test.tsx` mit MSW: Hinzufügen schickt
  genau ein `PUT …/sprechgruppen/505` und kein `PATCH`; Teilablehnung zeigt den Grund an der Zeile
  ohne Toast. `mise exec -- pnpm -C frontend test -- EinheitFunk EinheitDetailPage` grün.
- [ ] 2.5 Anwenderdoku `docs/anwender/kapitel/einheiten.md`, Schritt „Sprechgruppen“: jede
  Änderung steht im Einsatztagebuch. Wächter der Anwenderdoku laut `docs/anwender/AGENTS.md` grün.

## 3. Integration

- [ ] 3.1 `./scripts/check-all.sh` (Bündel nach `scripts/AGENTS.md`) grün; Kästchen, die erst die
  CI des PRs belegt, mit Verweis auf diesen Lauf abhaken.

## Workflow follow-up

- Zunder-Nachzug anlegen: Abschnitt und Führungsstelle auf Einzelwege samt ETB umstellen.
- `/opsx:archive pcrn0wn1-einheit-sprechgruppen-einzelwege` im selben Branch, dann PR gegen
  `alpha`.
