# Proposal

## Why

Der Spike LFH-720 hat gezeigt: In der macOS-Hülle (WKWebView) scheitert jeder Passkey. Das
gilt für Lifeline selbst (RP `elw.local`): `NotAllowedError` nach 4 ms, ohne Systemabfrage,
trotz Fokus und Nutzergeste. Es gilt auch für den Passkey beim IdP (PocketID). Windows
(WebView2) trägt. Variante B/C löst das nicht. LFH-128 Phase 1 braucht eine Entscheidung, wie
die Mac-Hülle damit umgeht, bevor Hüllencode entsteht.

## What Changes

- **Entscheidung (29.09.2026): gestaffelt.**
  - **Stufe 1 (Phase 1):** Die macOS-Hülle bietet keinen Passkey an, weder Anmeldung noch
    Einrichtung. Passwort und OIDC tragen. Die Hülle meldet diese Grenze selbst, weil die
    Feature-Erkennung des Webviews lügt.
  - **Stufe 2 (danach):** Anmeldung im Systembrowser mit Übergabe der Sitzung per Einmalcode.
    Sie beginnt mit einer Messung und löst dann den Passkey von Lifeline und den des IdP.
- Verworfen: Associated Domains im MDM-Modus. Herleitung in `design.md`.
- Anforderungen an die Hülle als Delta zu `desktop-huelle` (`specs/desktop-huelle/spec.md`).
- **Kein Code in diesem Change.** Die Umsetzung liegt in LFH-817 (Stufe 1) und LFH-818 (Stufe 2).

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `desktop-huelle` (eingeführt mit LFH-720): Anforderungen zu Passkey und Fähigkeitskennung der
  Hülle.

## Impact

- Kein Code, keine Migration, keine API-Änderung in diesem Change.
- Stufe 2 bringt einen Server-Endpunkt (Einmalcode einlösen). Das ist eine bewusste Abweichung
  von „Abhilfen nur in der Hülle“ aus LFH-720 und in `design.md` begründet.
