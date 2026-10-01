# Tasks

## 1. Baustein `MenueAusloeser`

- [x] 1.1 `components/MenueAusloeser.test.tsx` anlegen mit den Fällen 1–5 aus design.md D6 (kein Knopf ohne Einträge; Name, `type="text"`, `aria-hidden`-Hülle, `gesperrt`/`laeuft`; lazy mount über `.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]` + `within`; Reihenfolge, ein Trenner, `danger`, `aria-disabled`; `onWahl` genau einmal mit Schlüssel). Prüfen: Test läuft ROT (Modul fehlt)
- [x] 1.2 `components/MenueAusloeser.tsx` bauen (API aus D1, Dateikopf nennt LFH-365/LFH-683); `MenueEintrag` und `menueEintraege` aus `components/Datensicht.tsx` hierher ziehen, `Datensicht` re-exportiert nicht, alle Importe (`StellenBlock`, `PersonenDetailPage`, Tests) zeigen auf den Baustein. Prüfen: 1.1 grün, `tsc` grün
- [x] 1.3 Fall 6 aus D6 (Portal-Aufsteigen) mit Gegenprobe am nackten `Dropdown` ergänzen, dann den Riegel aus D2 einbauen. Prüfen: Fall 6 vor dem Riegel rot, danach grün; Mutationsprobe (Riegel auskommentiert → rot) im Abschlussvermerk festhalten. **Ergebnis:** Fall 6 ohne Riegel rot, mit grün; Gegenprobe am nackten `Dropdown` feuert den Vorfahren; Mutationsprobe (Riegel → `void event`) rot

## 2. `Datensicht` und Tabellen-Nachbau

- [x] 2.1 `components/Datensicht.tsx` (`weitere`) rendert `MenueAusloeser`; Doku an `WeitereAktionen` und `pruefeVerlassen` nachziehen. Prüfen: `Datensicht*.test.tsx` und `datensicht.guard.test.ts` grün
- [x] 2.2 `betreuung/StellenBlock.tsx` umstellen (Schlüssel als `StelleAktion`, kein `as`). Prüfen: `StellenBlock`-/`BetreuungPage.test.tsx` grün, Name „Aktionen zu Stelle …“ unverändert

## 3. Karten, Chips, Leisten

- [x] 3.1 `etb/EtbZeitachse.tsx` umstellen („Berichtigen (Grund)“ als `gesperrt`). Prüfen: `EtbZeitachse.test.tsx`, `EtbPage.test.tsx` grün
- [x] 3.2 `etb/MetaChip.tsx` umstellen (`gesperrt` am Auslöser; Geschwister-Schnellweg bleibt, Kommentar nennt den Riegel im Baustein als zweite Sicherung). Prüfen: `MetaChip.test.tsx` grün, auch der B5g-Regressionsfall
- [x] 3.3 `pages/lagekarte/Sidebar.tsx` umstellen (Ikonen über `ikone`). Prüfen: Sidebar-Tests grün
- [x] 3.4 `verpflegung/ZeitfensterKarte.tsx` umstellen (eigene Trenner-Logik entfällt). Prüfen: `ZeitfensterKarte.test.tsx`, `VerpflegungPage.test.tsx` grün
- [x] 3.5 `meldungen/MeldungKarte.tsx` umstellen (Einträge als Daten, Zuordnung über `onWahl`; erhält `autoFocus`). Prüfen: `MeldungKarte.test.tsx`, `MeldungenPage.test.tsx` grün
- [x] 3.6 `abloesung/AbloesungKarte.tsx` umstellen. Prüfen: Ablösungs-Tests grün
- [x] 3.7 `pages/einstellungen/EinsatzPegel.tsx` umstellen (Einheitsform D3, `gesperrt` für oben/unten und am Auslöser während `laeuft`); Test für die Reihenfolge aus dem Spec-Szenario „Pegel mit Prognose“ ergänzen. Prüfen: `EinsatzPegel.test.tsx` grün
- [x] 3.8 `pages/PersonenDetailPage.tsx` umstellen (`laeuft` statt `loading`, `autoFocus` am Baustein statt am `menu`). Prüfen: PersonenDetail-Tests grün

## 4. Chat

- [x] 4.1 Tests in `chat/NachrichtenStrom.test.tsx` zuerst umschreiben: Name „Aktionen zu Nachricht von ‹Autor›, ‹Uhrzeit›“; Löschen über Dialog (Titel, „Ja, löschen“ löscht, „Abbrechen“ lässt stehen); gelöschte Nachricht ohne Auslöser. Prüfen: Tests ROT
- [x] 4.2 `chat/NachrichtenStrom.tsx` umstellen (D4: `MenueAusloeser`, `<Modal>` außerhalb von `renderItem`, kein `Popconfirm`). Prüfen: 4.1 grün, `pages/ChatPage.test.tsx` grün (angepasst, falls er den alten Namen nutzt)

## 5. Wächter und Regel

- [x] 5.1 `components/menueAusloeser.guard.test.ts` (D5, Muster `dichte.guard.test.ts`) mit Ausnahme `pages/lagekarte/AnsichtSwitcher.tsx` samt Grund. Prüfen: grün; Mutationsprobe (eine Kopie zurückgeschrieben → rot)
- [ ] 5.2 e2e-Fall „Fokus springt ins Menü“ in einem bestehenden Spec ergänzen, der ein Menü ohnehin öffnet (z. B. Meldungen oder ETB): Auslöser per Tastatur öffnen, Fokus liegt im `[role="menu"]`, Escape schließt. Prüfen: Spec grün; Mutationsprobe `autoFocus` entfernt → rot
- [x] 5.3 `frontend/AGENTS.md`, Abschnitt „Aktionen“: Absatz „Datensatz-Aktionen werden gebündelt“ auf den Baustein umstellen (Mechanik dort, hier nur Zählung, Modal, Rechte-Riegel, Guard); Kommentarverweise „`autoFocus` wie am Aktionsmenü in …“ per `grep` nachziehen. Prüfen: Prettier über `frontend/` grün, `grep -rn "autoFocus wie am" frontend/src` zeigt nur noch gültige Verweise

## 6. Gesamtlauf

- [ ] 6.1 `./scripts/check-all.sh` grün (bzw. die Bündel, die in der Umgebung laufen; der volle Lauf wird mit der CI des PRs belegt); `e2e/gate3-trefflaeche.spec.ts` für die betroffenen Seiten grün (Layout der Hülle). Ergebnis hier vermerken
