# Tasks

## 1. Tagpalette anheben (gerechnet)

- [ ] 1.1 `frontend/src/theme/bedienKontrast.test.ts` anlegen (Muster `rahmenKontrast.test.ts`, Böden als Literale): `aufBedien` auf `bedien` und auf `bedienHover` Tag ≥ 7, Nacht ≥ 5; `bedien` ≠ `bedienHover` je Palette. Prüfen: Test läuft mit den alten Werten ROT (6,59 / 5,62)
- [ ] 1.2 `farbenHell.bedien` → `#154e84`, `farbenHell.bedienHover` → `#185895` in `theme/tokens.ts` und `theme/rollen.css` (Tagblock); Kontrast-Kommentar über `farbenHell` mit neuen Werten und dem Boden („kein eigener Knopfboden, LFH-661“) fortschreiben. Prüfen: 1.1 grün, `rollen.guard.test.ts` grün
- [ ] 1.3 `theme/gate5.guard.test.ts`: im Rollenwert-Muster `1a5fa0` durch `154e84` ersetzen, `185895` ergänzen; vorher per grep sicherstellen, dass beide Werte nirgends sonst hart stehen. Prüfen: Gate-5-Guard grün, Mutationsprobe (ein `#154e84` in eine Komponente geschrieben → rot)

## 2. Browser-Nachweis Primärknopf

- [ ] 2.1 `frontend/e2e/primaerknopf-kontrast.spec.ts`: Tag und Nacht, Messkern `kontrast-kern.ts`; Knopf „Anmelden“ auf `/login` und Absende-Knopf des Dialogs „Neuer Einsatz“ je in Ruhe und unter dem Zeiger (nach Übergang, `toPass`); Zusicherung, dass die Knopffläche unter dem Zeiger eine andere ist als in Ruhe. Prüfen: Spec grün; Mutationsprobe `bedienHover` zurück auf `#236aad` → Hover-Messung am Tag rot

## 3. Ausnahme „Weiß auf bedien → LFH-661“ entfernen

- [ ] 3.1 `e2e/abloesung-kontrast.spec.ts`: Zweig und Kopfkommentar der Ausnahme entfernen, Primärknöpfe als tragender Text; „ohne Ausnahme gesehen“ für „Schicht beginnen“/„Vollziehen“ zusichern. Prüfen: Spec grün in light und dark
- [ ] 3.2 `e2e/verpflegung-kontrast.spec.ts`: wie 3.1 (Kopfknopf, Absende-Knöpfe der Dialoge). Prüfen: Spec grün in light und dark
- [ ] 3.3 `e2e/betreuung-pruefliste.spec.ts`: LFH-661-Zweig entfernen, LFH-693 bleibt; „Speichern“ und „Evakuierungsbezirk anlegen“ von „nur am Tag unter Ausnahme“ auf „ohne Ausnahme“ umstellen. Prüfen: Spec grün in light und dark; `grep -rn LFH-661 frontend` trifft nur noch Kommentare am neuen Wert und den neuen Spec

## 4. Nachbarn und Gesamtlauf

- [ ] 4.1 Übrige Kontrast-Specs (`betroffene-`, `hellmodus-`, `kraefte-`, `fachebenen-kontrast.spec.ts`) gegen die neuen Werte laufen lassen; Links in Bedienfarbe und Kachellink unter dem Zeiger am Tag messen und, falls < 7, als Nachzug auf dem Entwicklungsboard erfassen (Ticketnummer hier eintragen). Prüfen: Specs grün, Nachzug angelegt oder „nicht nötig“ vermerkt
- [ ] 4.2 `./scripts/check-all.sh` grün (bzw. die Bündel, die in der Umgebung laufen; der volle Lauf wird mit der CI des PRs belegt)
