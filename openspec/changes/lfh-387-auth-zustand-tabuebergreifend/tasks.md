# Tasks

## 1. Backend: Schreibanfragen an den erwarteten Benutzer binden

- [ ] 1.1 `src/error.rs`: Variante `SitzungsBenutzerMismatch` → 412 mit eigener Meldung; verifizieren: Unit-Test neben `offline_queue_benutzerwechsel_ist_412_ohne_auth_401_umzudeuten`
- [ ] 1.2 `src/auth/session.rs`: Konstante `ERWARTETER_BENUTZER_ID_HEADER` (`x-erwarteter-benutzer-id`); `CurrentUser` prüft nach der Sitzungsauflösung bei nicht-sicherer Methode den Kopf (fehlt → ok, ungültig/abweichend → 412), nach D1; verifizieren: Unit-Tests in `session.rs` für POST passend/abweichend/ungültig/fehlend, GET mit abweichendem Kopf → kein 412, tote Sitzung + Kopf → 401
- [ ] 1.3 `src/routes/auth.rs` `logout`: Kopf vorhanden, Sitzung gültig, Benutzer abweichend → 412 ohne Löschen und ohne Cookie-Entfernung (D3); verifizieren: Integrationstest in 1.4
- [ ] 1.4 `tests/sitzung_benutzerwechsel.rs` nach D9 (je eine Schreibroute über `EinsatzKontext`, `AdminUser`, `CurrentUser`; jeweils Paar passend/abweichend mit Nachweis „kein Datensatz“; Logout-Paar mit `/api/auth/me` danach); verifizieren: `cargo test --test sitzung_benutzerwechsel` grün, Mutationsprobe (Prüfung in `CurrentUser` auskommentiert → Test rot)

## 2. Frontend: Kopf, Ereignis und Tab-Kanal

- [ ] 2.1 `api/client.ts`: `setzeErwartetenBenutzer`, Kopf `X-Erwarteter-Benutzer-Id` an `apiSend` (nicht-GET) und `apiUpload`; jede 412 feuert `lfh:benutzer-pruefen` (Konstante in `auth/sitzungsEvent.ts`); verifizieren: `client.test.ts` — Kopf an POST und Upload, nicht an GET, nicht ohne gesetzten Benutzer, Ereignis bei 412, keins bei 401/409
- [ ] 2.2 `auth/authKanal.ts` (`meldeAuthWechsel`, `abonniereAuthWechsel`, No-op ohne `BroadcastChannel`); verifizieren: `authKanal.test.ts` mit zwei Kanälen im selben Realm und dem Fall „kein BroadcastChannel“
- [ ] 2.3 Guard: kein `fetch(` mit schreibender Methode in `frontend/src` außerhalb von `api/client.ts`; verifizieren: `api/schreibwege.guard.test.ts` grün, Gegenprobe mit eingeschleustem Beispiel rot
- [ ] 2.4 `offline/fehler.ts`: Kommentar zu 412 auf beide Quellen erweitern (Verhalten unverändert); verifizieren: `ereignisse`/`useOfflineSync`-Tests grün

## 3. Frontend: AuthProvider prüft, meldet und hält den Konflikt

- [ ] 3.1 `auth/AuthContext.tsx`: `uebernimm(b)` setzt Benutzer und `setzeErwartetenBenutzer` synchron; `pruefe()` nach D6 (zusammengefasst, erst nach Erstladen); Auslöser Kanal, `lfh:benutzer-pruefen`, `visibilitychange`; `konflikt` und `weiterAls()` im Context; verifizieren: `AuthContext.test.tsx` je Zeile der Ergebnistabelle (gleich, übernehmen, Konflikt, 401 → lokal ab + Ablaufmeldung, Netzfehler → unverändert)
- [ ] 3.2 `logout()` nach D7 (412 → kein lokales Abmelden, Prüfung) und neues `abmeldenLokal()`; `login`/`aktualisiere`/Abmelden melden über den Kanal; verifizieren: Tests „Logout-412 räumt nicht“, „Logout meldet abgemeldet“, „Login meldet angemeldet“
- [ ] 3.3 `auth/useSitzungsWache.ts` nimmt `abmeldenLokal()` statt `logout()`; verifizieren: `useSitzungsWache.test.tsx` — kein `POST /api/auth/logout` bei Ablauf, Umleitung mit Rückkehr-URL unverändert
- [ ] 3.4 Zwei-Tab-Test im Vitest: zwei `AuthProvider` im selben Realm, Kanal echt, `me()` gemockt; schneller A→B-Wechsel in „Tab 2“ → „Tab 1“ im Konflikt; verifizieren: Test grün

## 4. Frontend: Konfliktdialog

- [ ] 4.1 `auth/BenutzerKonfliktDialog.tsx` nach D8, eingehängt im Sitzungs-Layout neben `useSitzungsWache`; verifizieren: `BenutzerKonfliktDialog.test.tsx` — nennt beide Anzeigenamen, Escape/Maske schließen nicht, genau ein Primärknopf, Klick räumt den QueryClient, übernimmt B und navigiert zur Startseite

## 5. e2e und Doku

- [ ] 5.1 `e2e/sitzung-mehrere-tabs.spec.ts` mit den drei Fällen aus D9 (schneller Wechsel, gleichzeitige Mutation mit 412 und ohne Eintrag, Sitzungsablauf in beiden Tabs); verifizieren: `pnpm e2e -- sitzung-mehrere-tabs` grün
- [ ] 5.2 CLAUDE.md: Absatz „Sitzung über mehrere Tabs (LFH-387)“ (Kopf + `CurrentUser`, Logout-412, Wache meldet nur lokal ab, Kanal ist Komfort, Server ist Wahrheit); verifizieren: Absatz verweist auf dieses `design.md`

## 6. Integration

- [ ] 6.1 `./scripts/check-all.sh` vollständig; verifizieren: alle Schritte grün (Ausgabe ohne `| tail`)
