# Tasks

## 1. Server: Freigabe des Zielmoduls

- [x] 1.1 Test in `tests/chat.rs`: Führungsperson ohne Admin-Rechte, `etb` per Override auf Admins beschränkt, Heraufstufen ins ETB → 403, Nachricht ohne `etb_eintrag_id`, kein ETB-Eintrag; vorher rot gesehen
- [x] 1.2 Test: dieselbe Führungsperson mit freiem `etb` → Eintrag entsteht (erlaubter Fall)
- [x] 1.3 `heraufstufen` in `src/routes/chat.rs` ruft zuerst `ctx.fordere_modul_zugriff` mit dem Marker `Etb`; 1.1 und 1.2 grün
- [x] 1.4 Test: `auftraege` auf Admins beschränkt, Heraufstufen zum Auftrag → 403, weder Auftrag noch Verweis; vorher rot gesehen
- [x] 1.5 Test: `etb` gesperrt, `auftraege` frei → Heraufstufen zum Auftrag gelingt (D2)
- [x] 1.6 `heraufstufen_auftrag` ruft zuerst `ctx.fordere_modul_zugriff` mit dem Marker `Auftraege`; 1.4 und 1.5 grün, übrige Tests in `tests/chat.rs` grün
- [x] 1.7 Den Verweis „Nachzug“ in den Handler-Kommentaren durch die Regel ersetzen (Spec `modul-freigabe`); `cargo fmt --check` und `cargo clippy` ohne neue Warnung

## 2. Client: Menü im Chat

- [x] 2.1 Test in `NachrichtenStrom.test.tsx`: mit `etbGesperrt` steht „Zu ETB (Keine Berechtigung)“ deaktiviert im Menü, ein Klick ruft `onHeraufstufen` nicht; „Zu Auftrag“ bleibt bedienbar; vorher rot gesehen
- [x] 2.2 Test: mit `auftragGesperrt` dasselbe für „Zu Auftrag“; ohne Schalter unverändert
- [x] 2.3 `NachrichtenStrom` nimmt `etbGesperrt`/`auftragGesperrt` und baut die Einträge mit `gesperrt` und `KEINE_BERECHTIGUNG`; 2.1 und 2.2 grün
- [x] 2.4 `ChatPage` füllt die Schalter über `useSprungSperre(einsatzId)`; Test in `ChatPage.test.tsx`: Freigaben mit `etb: zugriff false` → Eintrag gesperrt; bestehende ChatPage-Tests grün
- [x] 2.5 `pnpm lint`, `tsc` und Prettier für `frontend/` grün

## 3. Abschluss

- [x] 3.1 `./scripts/check-all.sh` gelaufen; umgebungsbedingt rote Schritte gegen `origin/alpha` gegengeprüft (Desktop-Hülle ohne GTK, `kartenbilder` unter Node 22, e2e-Dichte-Fälle in `trefflaeche-pruefflaechen`); der volle Lauf belegt die CI des PRs
