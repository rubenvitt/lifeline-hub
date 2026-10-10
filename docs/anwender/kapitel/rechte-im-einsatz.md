---
titel: Rechte im Einsatz
gruppen: [fuehrung, administration]
reihenfolge: 40
quellen: [src/einsatz/berechtigung.rs, src/einsatz/kontext.rs, frontend/src/einsatz/schreibrecht.ts, frontend/src/pages/MitgliederAbschnitt.tsx, src/routes/benutzer.rs]
---

## Überblick

Was eine Person in einem Einsatz darf, hängt an ihrer Rolle in diesem Einsatz: **Einsatzleitung**,
**Führungspersonal** oder **Beobachter**. Die Rollen vergibt die Einsatzleitung eines laufenden
Einsatzes in den Einsatzdaten. Ohne Rolle lesen Führungskräfte der Organisation und System-Admins
mit; schreiben dürfen sie dort nur eingeschränkt.

## Abläufe

### Eine Person in den Einsatz aufnehmen

1. „Einsatzdaten“ öffnen.
2. Im Abschnitt „Zugriff“ unter „Benutzer …“ die Person wählen und daneben ihre Rolle.
3. „Hinzufügen“ wählen.

### Eine Rolle ändern oder entziehen

1. Im Abschnitt „Zugriff“ der Einsatzdaten bei der Person eine andere Rolle wählen.
2. Zum Entziehen „Entfernen“ wählen und die Rückfrage „Mitglied entfernen?“ mit „Entfernen“
   bestätigen.

Wer die eigene Rolle herabstuft, bestätigt das zuerst mit „Rolle herabstufen“: danach endet das
Recht, den Zugriff des Einsatzes zu verwalten.

## Hintergrund

### Was die Rollen dürfen

- **Einsatzleitung** und **Führungspersonal** schreiben in den Modulen, ändern Kopfdaten,
  Einstellungen und die eigene Führungsstelle.
- **Beobachter** lesen nur.
- Nur die **Einsatzleitung** verwaltet den Zugriff und koppelt Geräte.

Die Rolle gilt auch, wenn die Person zu einer anderen Organisation gehört als der Einsatz. Die
letzte Einsatzleitung eines Einsatzes lässt sich nicht entfernen („Gesperrt: letzte
Einsatzleitung“).

Die Auswahl „Benutzer …“ füllt sich nur für System-Admins („Benutzerliste nur für Admins“). Eine
Einsatzleitung ohne diese Rolle ändert die Rollen der eingetragenen Mitglieder, nimmt aber
niemanden neu auf.

### Ohne Rolle im Einsatz

- Eine **Führungskraft der Organisation** liest jeden Einsatz der eigenen Organisation, schreibt
  darin aber nichts.
- Ein **System-Admin** liest jeden Einsatz, auch den einer anderen Organisation. Ändern darf er
  ohne Rolle nur an Einsätzen der eigenen Organisation, und dort nur die Verwaltungsangaben:
  Kopfdaten, Einstellungen, Führungsstelle, Aufbewahrungsfrist und Module. In den Modulen selbst
  (Einsatztagebuch, Kräfte, Lagekarte …) schreibt er erst mit einer Rolle.
- An einem Einsatz einer anderen Organisation schreibt ein System-Admin nur mit einer Rolle in
  diesem Einsatz.

Wo ein Recht fehlt, steht die Seite auf „Nur Ansicht“ und nennt, wer schreiben darf.

### Abgeschlossener Einsatz

Ein abgeschlossener Einsatz ist schreibgeschützt, auch für Einsatzleitung und System-Admin; nur
die Aufbewahrungsfrist lässt sich noch ändern. Mitglieder lesen ihn noch 24 Stunden nach dem
Abschluss, danach nur noch die Einsatzleitung, Führungskräfte der Organisation und System-Admins.
Nach Ablauf der Aufbewahrungsfrist liest ihn niemand mehr.
