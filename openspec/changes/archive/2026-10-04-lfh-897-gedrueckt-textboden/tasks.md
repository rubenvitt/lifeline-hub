# Tasks

## 1. Komponenten-Tokens für den Zustand gedrückt (gerechnet)

- [x] 1.1 `frontend/src/theme/bedienKontrast.test.ts`: Im Block „Primärknopf“ den Zustand gedrückt rechnen, `aufBedien` auf `antdKomponenten(farben, 'kompakt').Button.colorPrimaryActive` (Tag ≥ 7, Nacht ≥ 5), dazu die Zusicherung, dass er sich von `bedien` unterscheidet. Ein fehlendes Komponenten-Token ist ein Befund, kein Rückfall auf antd (Muster `token()` aus `gefahrKontrast.test.ts`). Prüfen: Der Test läuft vor 1.3 ROT
- [x] 1.2 `frontend/src/theme/gefahrKontrast.test.ts`: Gefahrknopf ohne Rahmen gedrückt, `Button.colorErrorActive` auf `Button.colorErrorBgActive` (Tag ≥ 7, Nacht ≥ 5), dazu `colorErrorBgActive` ≠ `grund`. Der umrandete Gefahrknopf bekommt gedrückt `colorErrorActive` auf `flaeche` in die bestehende Reihe. Prüfen: Der Test für den Knopf ohne Rahmen läuft vor 1.3 ROT
- [x] 1.3 `frontend/src/theme/tokens.ts`, `antdKomponenten` → `Button`: `colorPrimaryActive: farben.bedienHover` und `colorErrorBgActive: farben.alarmFlaeche`, jeweils mit Kommentar (warum gedrückt = Zeigerton, design.md E2). Die Kontrast-Kommentare über `farbenHell` und `farbenDunkel` um die Werte gedrückt ergänzen (Primärknopf Tag 7,32 / Nacht 9,00, Gefahrknopf ohne Rahmen 8,52 / 7,66). Prüfen: 1.1 und 1.2 grün, `tokens.test.ts`, `rollen.guard.test.ts` und `gate5.guard.test.ts` grün. Mutationsprobe: Ohne `colorPrimaryActive` wird 1.1 nachts rot, ohne `colorErrorBgActive` wird 1.2 in beiden Modi rot

## 2. Browser-Nachweis

- [x] 2.1 `frontend/e2e/kontrast-kern.ts`: Messung des Zustands gedrückt neben `ruheUndZeiger` (design.md E3). Zeiger auf die Knopfmitte, `mouse.down()`, Wechsel der Fläche gegenüber der Ruhe zusichern, stehendes Bild messen, Zeiger wegziehen, dann `mouse.up()`. Prüfen: Wird in 2.2 und 2.3 benutzt. Kein Klick wird ausgelöst (Anmeldeseite bleibt stehen, Rückfrage bleibt zu)
- [x] 2.2 `frontend/e2e/primaerknopf-kontrast.spec.ts`: „Anmelden“ zusätzlich gedrückt messen, Tag und Nacht. Prüfen: Spec grün in light und dark. Mutationsprobe: Ohne `Button.colorPrimaryActive` wird die Nachtmessung rot
- [x] 2.3 `frontend/e2e/gefahr-kontrast.spec.ts`: Ein Dokument anlegen und den Papierkorb „Dokument … entfernen“ in Ruhe, unter dem Zeiger und gedrückt messen. Den umrandeten Gefahrknopf „Deaktivieren“ zusätzlich gedrückt messen. Kopfkommentar fortschreiben (was gemessen wird, warum das Banner nur gerechnet ist). Prüfen: Spec grün in light und dark. Mutationsprobe: Ohne `Button.colorErrorBgActive` wird die Messung des Papierkorbs rot

## 3. Regel und Gesamtlauf

- [x] 3.1 `frontend/AGENTS.md`, Farbachsen: Im Eintrag zu Gefahrrot und Primärknopf ergänzen, dass auch der Zustand gedrückt aus `antdKomponenten` kommt (gedrückt = Zeigerton, Gefahrknopf ohne Rahmen auf `alarmFlaeche`) und nicht aus antds Ableitung. Prüfen: Prettier über `frontend/` grün, Datei bleibt im Stil der Nachbareinträge
- [x] 3.2 Übrige Kontrast-Specs gegen die neuen Tokens laufen lassen (`hellmodus-`, `betroffene-`, `hinweis-`, `fokusring-kontrast.spec.ts`, `betreuung-pruefliste.spec.ts`). Prüfen: Specs grün. **Ergebnis:** 34 Tests grün (Chromium)
- [x] 3.3 `./scripts/check-all.sh` grün (bzw. die Bündel, die in der Umgebung laufen; der volle Lauf wird mit der CI des PRs belegt). **Ergebnis lokal (Cloud-Sitzung):** Bündel `schnell` grün, Typecheck und Lint grün, Vitest voll 9512/9512, Kontrast-e2e (Primärknopf, Gefahrrot, Hellmodus, Betroffene, Hinweis, Fokusring, Betreuung) grün; im Browser gemessen ohne die beiden Tokens genau die gerechneten Werte (Primärknopf nachts 3,35, Papierkorb 4,13 / 4,49). Voller Lauf: CI des PRs
