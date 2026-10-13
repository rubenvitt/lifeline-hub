# Design

## Context

Den Anlass beschreibt `proposal.md` („Why“). Für die Entscheidung zählt:

- `GET /api/org-modul-einstellungen` hängt am Benutzer, nicht am Einsatz (`benutzer.org_id`), und
  ist mit `darf_admin_bereich` verschlossen (System-Admin, Führungskraft der Organisation).
- `GET /api/einsaetze/{id}/modul-overrides` liest jeder mit Lesezugriff auf den Einsatz
  (`EinsatzLesezugriff`), dazu jeder System-Admin, auch einer fremden Organisation
  („lesen bleibt serverweit“, `tests/modul_override.rs`,
  `admin_einer_fremden_org_setzt_keinen_override`). Die Antwort ist eine dünne Map
  `modul_key → EinsatzModulOverride`, nur für Module mit eigener Zeile.
- `GET …/modul-freigaben` liefert den wirksamen Wert (`sichtbar`, `zugriff`), aber nicht die
  Herkunft. Daraus leitet der Editor heute die Org-Ausblendung her, solange der Einsatz keinen
  eigenen Wert trägt; die Rollen-Vorgabe lässt sich so gar nicht herleiten.
- Ein Benutzer einer fremden Organisation kann Mitglied eines Einsatzes sein, etwa als
  Einsatzleitung (LFH-753, LFH-995).

## Goals / Non-Goals

**Goals:**

- Wer den Editor „Module“ öffnet, sieht Rollen- und Sichtbarkeits-Herkunft wie ein System-Admin.
- Das Leserecht ist an einen Einsatz gebunden und umfasst nur die Modul-Vorgaben.

**Non-Goals:**

- Die übrigen Org-Vorgaben (Zeitzone, Fristen, Präfixe …), deren Hinweise in den anderen
  Einstellungs-Sektionen einer Einsatzleitung ohne Org-Rolle ebenfalls fehlen. Das ist dieselbe
  Lücke an anderer Stelle und bleibt ein eigenes Thema.
- Live-Frische über Benutzer hinweg: Org-Vorgaben haben kein Ereignis (`NICHT_LIVE_GLOBAL_KEYS`),
  daran ändert sich nichts.

## Decisions

### D1 — Ein eigener einsatzbezogener Lesepfad `GET /api/einsaetze/{id}/modul-vorgaben`

Der Pfad liefert `modul_einstellung::laden_alle(einsatz.org_id)` in der Form von
`GET /api/org-modul-einstellungen` (`HashMap<String, OrgModulEinstellung>`, dünn). Der Editor
holt die Vorgaben dort statt am Org-Endpunkt.

Alternativen:

- **A — Leserecht auf `GET /api/org-modul-einstellungen` für die Einsatzleitung.** Der Endpunkt
  kennt keinen Einsatz. „Einsatzleitung“ hieße „Einsatzleitung irgendeines Einsatzes der
  Organisation“, also eine Abfrage über alle Mitgliedschaften bei jedem Abruf. Ein Mitglied aus
  einer fremden Organisation bekäme die Vorgaben seiner eigenen Organisation statt der des
  Einsatzes, also die falschen Hinweise. Verworfen.
- **B — Vorgaben in die Antwort von `…/modul-overrides` aufnehmen.** Die Antwort ist eine dünne
  Map von Override-Zeilen mit `einsatz_id`, `geaendert_at` usw. Die Vorgaben passen nur hinein,
  wenn sich die Form ändert: entweder eine Hülle `{ overrides, org_vorgaben }` oder je Modul ein
  Eintrag, auch ohne Override-Zeile. Beides bricht die Form, und das Lese-Gate der Overrides
  reicht über die Organisation hinaus (siehe D2). Verworfen.
- **D1 ist B ohne Formbruch:** einsatzbezogen wie B, mit eigenem Gate, und die Antwort ist die
  vorhandene `OrgModulEinstellung`. Generierte Typen bekommen nur einen Pfad dazu.

### D2 — Gate: Lesezugriff auf den Einsatz plus Mitgliedschaft oder dieselbe Organisation

`EinsatzLesezugriff` allein reicht nicht: Er lässt jeden System-Admin serverweit lesen, und die
Vorgaben einer Organisation gingen damit an Admins fremder Organisationen. Der Handler verlangt
deshalb zusätzlich `ctx.rolle.is_some() || benutzer.org_id == einsatz.org_id`:

- Einsatzleitung, Führungspersonal und Beobachter des Einsatzes lesen, auch aus einer fremden
  Organisation. Wer im Einsatz mitarbeitet, darf wissen, woher dessen Modulregeln stammen; den
  Schalter und die Freigaben sieht er ohnehin.
- System-Admin und Führungskraft der Einsatz-Organisation lesen, auch ohne Mitgliedschaft.
- Ein System-Admin einer fremden Organisation ohne Mitgliedschaft bekommt 403.

Alternative: nur das Verwaltungsrecht am Einsatz (Einsatzleitung, System-Admin der Einsatz-Org),
wie beim Override-PUT. Das wäre enger, aber dann fehlten dem Führungspersonal die Hinweise im
schreibgeschützten Editor, den es sehen darf. Und die Vorgaben verraten nichts, was die
Freigaben nicht schon zeigen, außer der Herkunft. Verworfen.

### D3 — Modul-los, für Geräte gesperrt

Der Pfad kommt in `PFAD_KEY` als modul-los, wie `…/modul-overrides`. Ein Modul-Gate davor wäre
falsch, denn die Antwort beschreibt die Modulregeln selbst. In die Positivliste der Geräte
(`src/geraet/mod.rs`) kommt er nicht. Ein Gerät öffnet keine Einstellungen und bekommt 403 wie
für die Overrides.

### D4 — Client: eigener Einsatz-Key, Invalidierung aus der Verwaltung

- Neuer Key `einsatzKeys.modulVorgaben(einsatzId)` (Präfix `einsatz-modul-vorgaben`) in
  `NICHT_LIVE_KEYS`, mit Begründung wie bei `modulOverrides` und `modulFreigaben`: kein
  Live-Ereignis. Nicht in der Offline-Vorhaltung.
- `EinsatzModule.tsx` liest `modulVorgaben` statt `globalKeys.orgModulEinstellungen()`. Die
  Abfrage bleibt nicht blockierend; scheitert sie, bleibt der Rückfall „Ausblendung aus den
  Freigaben herleiten“ (`orgBlendetAus`), der Rollen-Hinweis fehlt dann wie heute.
- `EinsatzDefaults.tsx` invalidiert nach einem Speichern zusätzlich den Präfix
  `[einsatz-modul-vorgaben]`, also die Vorgaben aller Einsätze im Cache. Ein Admin, der danach
  einen Einsatz-Editor öffnet, sieht den neuen Stand ohne Neuladen.

## Risks / Trade-offs

- [Zwei Lesewege für dieselben Daten] → Beide rufen `modul_einstellung::laden_alle` und geben
  dieselbe Struktur zurück. Ein Test vergleicht die Antworten für einen Admin der Organisation.
- [Beobachter sehen die Vorgaben der Organisation] → Gewollt (D2). Es sind Modulregeln ohne
  Personenbezug, und die Wirkung sehen Beobachter ohnehin in ihrer Navigation.
- [Ein Mitglied aus fremder Organisation liest Vorgaben einer anderen Organisation] → Nur die
  Modul-Vorgaben und nur für den Einsatz, an dem es mitarbeitet. Das ist der Zweck.
- [Der Cache hält alte Vorgaben, wenn ein anderer Admin ändert] → Wie bisher beim Org-Key; der
  nächste Abruf (Fokus, Neuöffnen) holt den Stand.

## Migration Plan

Keine Datenänderung. Der neue Pfad ist rein additiv; ein älterer Client nutzt weiter den
Org-Endpunkt und bekommt dort, was er heute bekommt.

## Freigabe

Ruben hat am 13.10.2026 freigegeben, wie empfohlen:

- Eigener einsatzbezogener Lesepfad `GET /api/einsaetze/{id}/modul-vorgaben` (D1) statt A oder B.
- Lesekreis nach D2: alle Mitglieder des Einsatzes einschließlich Beobachter sowie Angehörige der
  Einsatz-Organisation; ein System-Admin einer fremden Organisation ohne Mitgliedschaft nicht.
