---
titel: Rechte im Einsatz
gruppen: [fuehrung, administration]
reihenfolge: 40
quellen: [src/einsatz/berechtigung.rs, src/einsatz/kontext.rs, frontend/src/einsatz/schreibrecht.ts]
---

## Rolle im Einsatz

Was eine Person in einem Einsatz darf, hängt an ihrer Rolle in diesem Einsatz:

- **Einsatzleitung** und **Führungspersonal** schreiben in den Modulen, ändern Kopfdaten,
  Einstellungen und die eigene Führungsstelle.
- **Beobachter** lesen nur.

Die Rolle gilt auch, wenn die Person zu einer anderen Organisation gehört als der Einsatz.

## Ohne Rolle im Einsatz

- Eine **Führungskraft der Organisation** liest jeden Einsatz der eigenen Organisation, schreibt
  darin aber nichts.
- Ein **System-Admin** liest jeden Einsatz, auch den einer anderen Organisation. Ändern darf er
  ohne Rolle nur an Einsätzen der eigenen Organisation, und dort nur die Verwaltungsangaben:
  Kopfdaten, Einstellungen, Führungsstelle, Aufbewahrungsfrist und Module. In den Modulen selbst
  (Einsatztagebuch, Kräfte, Lagekarte …) schreibt er erst mit einer Rolle.
- An einem Einsatz einer anderen Organisation schreibt ein System-Admin nur mit einer Rolle in
  diesem Einsatz.

Wo ein Recht fehlt, steht die Seite auf „Nur Ansicht“ und nennt, wer schreiben darf.

## Abgeschlossener Einsatz

Ein abgeschlossener Einsatz ist schreibgeschützt, auch für Einsatzleitung und System-Admin; nur
die Aufbewahrungsfrist lässt sich noch ändern. Mitglieder lesen ihn noch 24 Stunden nach dem
Abschluss, danach nur noch die Einsatzleitung, Führungskräfte der Organisation und System-Admins.
Nach Ablauf der Aufbewahrungsfrist liest ihn niemand mehr.
