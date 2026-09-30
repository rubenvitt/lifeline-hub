# Prüfliste Einsatztauglichkeit: Stab mit Vorbereitung, Lage-Dashboard, Überblick (LFH-550)

Gate 7 der Bedien-Leitlinie (`docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`,
Festlegung 7) verlangt diese Liste an jeder neuen oder umgebauten Seite. Planung und Specs liegen
daneben (`proposal.md`, `design.md`, `specs/`).

## Geltungsbereich

| Angabe | Wert |
| --- | --- |
| Route | `/einsaetze/:id/stab`: neues Paneel „Vorbereitung“. Umgebaut ist die Datenquelle, das Aussehen bleibt: Führungsstand des Lage-Dashboards (`/lage-dashboard`) und Kennzahl „Offene Aufträge“ des Überblicks (`/ueberblick`). Die Summe der Stärke ändert sich auf Einsatzabschnitte und Bereitstellungsraum |
| Stand | Branch `claude/vibrant-ritchie-r787lc`, [rubenvitt/lifeline-hub#261](https://github.com/rubenvitt/lifeline-hub/pull/261) gegen `alpha` |
| Zielkontext | Fükw (primär: S2 bereitet die Besprechung vor), Führungs-Tablet (Lesen). Mobil: nur Lesen |
| Nicht enthalten | Die Lageplätze Pegel und Evakuiert in der Vorbereitung (Open Question in design.md). Der Warnton eines überfälligen Termins: [LFH-859](https://app.clickup.com/t/123zgec60yw) |

**Verdikte:** **erfüllt** (mit Beleg) · **offen → Zielticket** · **nicht anwendbar** (mit
Begründung). Gerechnetes und aus dem Quelltext Geschlossenes trägt **[abgeleitet]**.

## Die Nachweise

| Nachweis | Ergebnis |
| --- | --- |
| `e2e/stab-vorbereitung.spec.ts` | 2/2 grün. Betroffene, Kräfte und „Aufträge offen“ sind auf Stab und Dashboard gleich. Ein vollzogener Auftrag mit Quittungslücke zählt weder offen noch überfällig. Die Übernahme sendet genau EINEN `POST …/lageberichte` und öffnet danach den Bericht. Als Beobachter steht der Lagestand, die Übernahme fehlt |
| `e2e/gate1-ueberlauf.spec.ts` | Neu ist die Route `stab`, als Admin und als Beobachter. Vorbedingung für den Beobachter: keine Übernahme. Anker ist die Sichtungszeile, die längste Zeile. 25/25 grün bei 1366, 1024, 768 und 390 px |
| `e2e/gate3-trefflaeche.spec.ts` | Der Stab-Test misst neu (5) „In Lagebericht übernehmen“ bei 30/48/72 px. Beide Stab-Tests sind grün (Admin, Beobachter) |
| `e2e/lage-dashboard-schmal.spec.ts`, `lagebild-offline*.spec.ts`, `funkplan.spec.ts` | Grün nach dem Umbau auf `useLagebild` und den Modulzähler |
| Rust | Grün: `tests/verdichtung_fixture.rs` (3), `tests/modul_zaehler.rs` (10, `in_arbeit`, vollzogen nicht überfällig), `openapi_spec_aktuell`, Lib-Tests `einsatz::zaehler` und `einheit::repo` (32, darunter `kumuliere` mit Zyklus) |
| Vitest | Neu: `lage/verdichtungFixture.test.ts` (gemeinsames Fixture), `pages/lage-dashboard/fuehrungsZahlen.test.ts`, `stab/vorbereitung.test.ts`. Die Vorbereitungsfälle stehen in `pages/StabPage.test.tsx` (7). Umgestellt: `LageDashboardPage.test.tsx` (Führungsstand aus dem Zähler, keine Listenabrufe), `UeberblickPage.test.tsx`, `anzeige/staerke.test.ts`, `abschnittStaerke.test.ts`, `lageVerdichtung.test.ts` |
| Mutationsproben | (1) Rust: `ist_offen` um `Vollzogen` erweitert → `auftraege_zaehlen_wie_das_fixture` rot. (2) Client: `eskaliert` aus `istAlarmiert` entfernt → 2 Fixture-Fälle rot. (3) Alte `summiereStaerke` und `abschnittStaerken` eingesetzt → 3 Szenario-Tests rot. (4) Nur-Eltern-Prüfung (Review-Befund) → Fixture-Fall „A und Enkel G ohne B“ rot |
| Review | Ein Befund: Doppelzählung über ein fehlendes Zwischenglied. Behoben in `2df5d63`, das Fixture trägt eine dritte Ebene |
| Grep über die neuen Quellen (ohne Tests) | Farbliterale 0 (Farben aus `useRollen`) · `animation`/`blink` 0 · `size=` 0 · Emoji 0 |

---

## Tabelle: Stab mit Vorbereitung (und umgebaute Führungszahlen)

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **erfüllt** | Die Übernahme ist ein antd-`Button` (Steuerhöhe) und in Gate 3 bei 30/48/72 px gemessen. Die Zeilen der Vorbereitung sind kein Bedienziel | — |
| 2 | **Handschuh-Modus** | **erfüllt** | Kein punktuelles `size` (`dichte.guard.test.ts` grün). Gate 3 misst die Stufe Handschuh | — |
| 3 | **Rückmeldung vor der Serverantwort** | **erfüllt** | `loading` am Knopf. Der Fehler steht an der Seite (`SpeicherFehler`), kein Toast. Solange eine Quelle lädt, ist der Knopf gesperrt, mit Titel als Grund | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **nicht anwendbar** | Nichts wird gelöscht oder überschrieben. Die Übernahme legt einen Entwurf an, der bearbeitbar und löschbar bleibt | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** [abgeleitet] | Notiz und Quelle in `rollen.gedaempft` (Tag 7,05 : 1, Nacht darüber). Werte in `monoStil` in Textfarbe. Keine eigene Farbe | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Eine fehlende Quelle steht als „—“ plus Grund („nicht freigegeben“, „nicht geladen“, „lädt“). Die Alarmkante im Führungsstand trägt das Wort („1 überfällig“, „1 Bestätigung überfällig“) | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Keine neue Farbe. Der Alarmton im Führungsstand hängt jetzt an derselben Menge wie die Warnsperre (`bestaetigung_ueberfaellig`) | — |
| 8 | **Helligkeits-/Kontrastregler** | **erfüllt** [abgeleitet] | Die Deckschicht aus LFH-397 wirkt app-weit. Die Warnsperre liest weiter den Modulzähler | — |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** | Der überfällige Termin steht weiter oben im Paneel „Lagebesprechung“. Die Vorbereitung ist Lesestoff darunter. Der Führungsstand des Dashboards bleibt an seiner Stelle | — |
| 10 | **Alarmbudget** | **erfüllt** [abgeleitet] | Es entsteht keine neue Meldung. Die Übernahme navigiert, statt einen Toast zu zeigen. Der Alarmton „Meldungen“ zählt jetzt auch eskalierte, unbestätigte Meldungen. Das ist dieselbe Menge, die schon die Warnsperre und das Modulpanel tragen, also kein zusätzlicher Alarmbeitrag | — |
| 11 | **Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton (Grep) | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** [abgeleitet] | Die Vorbereitung hat immer genau zehn Zeilen in fester Reihenfolge. Live-Werte ändern sich an Ort und Stelle, es wird nichts eingeschoben | — |
| 13 | **Fokus nie verdeckt** | **erfüllt** [abgeleitet] | Auf der Stab-Seite gibt es keine angepinnte oder schwebende Leiste | — |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Keine Tabelle. Die Vorbereitung beantwortet „was ist mit diesem Einsatz?“ und ist deshalb eine Liste in einem Paneel (LFH-330) | — |
| 15 | **Erfassungsmaske vollständig** | **nicht anwendbar** | Es gibt keine Erfassung. Die Übernahme legt einen Freitext-Entwurf an, bearbeitet wird im Lagebericht | — |

**Bilanz:** 12 erfüllt · 0 offen · 3 nicht anwendbar.
