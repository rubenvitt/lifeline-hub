# Abnahme LFH-818 auf dem Mac (30.09.2026)

Aufbau wie in `messung.md`: Server `https://elw.local:8443` (TLS mit mkcert, mDNS, RP
`elw.local`, OIDC gegen PocketID). Dazu die echte Hülle „Lifeline Hub“: Debug-Bundle,
unsigniert, Stand f8ba7b54. Vivaldi war Standardbrowser. `rubeen` ist ein Konto, das nur per
SSO angelegt wurde (`passwort_hash` = Sentinel `!sso…`).

## Erster Durchgang: Absturz beim Rücksprung

Nach „In der App anmelden“ im Browser beendete sich die Hülle zweimal mit `SIGABRT`. Absturzberichte:
`lifeline-desktop-2026-09-30-152638.ips` und `…-152659.ips`.

Der Stapel lag in `NSXPCConnection` bei `_decodeAndInvokeReplyBlockWithEvent` →
`objc_exception_rethrow` auf einem Workqueue-Thread.

Ursache: `ASWebAuthenticationSession` ruft den Completion-Handler auf einer XPC-Queue auf, nicht auf
dem Hauptthread. Die Prüfung `debug_assert!(Hauptthread)` im Handler schlug an. Behoben in
f8ba7b54: Der Handler liest nur das Ergebnis aus und übergibt das Ende per `run_on_main_thread`.

## Zweiter Durchgang (Stand f8ba7b54)

Der Nutzer meldete „passt alles“ für die Punkte 1 bis 4 aus `tasks.md` 5.2. Belege aus Server und
Hülle:

| Punkt | Beleg |
| --- | --- |
| 1 SSO-Konto mit Passkey-only-IdP | `auth_audit` Nr. 1: `2026-09-30 13:35:35 login_ok rubeen (2) systembrowser` |
| 2 Lifeline-Passkey aus dem Browser | Nr. 4 `13:36:40 login_ok rubeen webauthn` (Anmeldung im Browser mit dem dort registrierten Passkey, `webauthn_credential` = 1), direkt danach Nr. 5 `13:36:42 login_ok rubeen systembrowser` |
| 3 Abbruch | Nutzerbeobachtung: Hinweis erscheint, Knopf bleibt bedienbar |
| 4 Erneuter Klick bei offenem Browserfenster | Nutzerbeobachtung: die zweite Anmeldung läuft durch. Keine neuen Absturzberichte nach 15:27 Ortszeit |
| Deeplink von außen | `open "lifeline://anmeldung?code=abab…"` → Protokoll der Hülle `13:38:09 Deeplink verworfen: lifeline://anmeldung` (ohne Code). Danach kein Eintrag in `auth_audit` |
| Zweites Einlösen / Frist | Belegt durch `tests/app_anmeldung.rs` (`code_gilt_nur_einmal`, `abgelaufener_code_ist_401`). Der Code ist von außen nicht sichtbar, deshalb kein `curl` gegen den echten Lauf |

Nebenbefund: Die Abmeldung schreibt im Audit den Anbieter `passwort`, auch bei einer Sitzung aus
`systembrowser` oder `webauthn` (Nr. 2, 3, 6). Das gehört zum Bestand und fällt unter LFH-846.

Nicht geprüft: Punkt 8 (Bestätigungslink auf einem Gerät ohne Mac-App). Der Warnsatz auf der
Bestätigungsseite steht. Ob ein Browser ohne Handler den Code lesbar zeigt, ist offen und steht
als Risiko im Design.
