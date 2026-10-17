# Kräfte-Zeitachse und Ablösung — Regeln

Gilt für `kraefte/zeitachse.ts`, `kraefte/KraftZeitachse.tsx`, `src/zeitachse/`,
`src/routes/zeitachse.rs` und jede Stelle, die einen Statuswechsel, eine Disposition, die
Ablösung oder das Eintreffen am Bereitstellungsraum schreibt (sie schreiben die Zeitachse mit);
der Absatz „Ablösung“ gilt für `abloesung/`, `pages/AbloesungPage.tsx`,
`pages/einstellungen/EinsatzAbloesung.tsx`, `stammdaten/SchichtmodelleTab.tsx`,
`src/abloesung/` und `src/schichtmodell/`. Ergänzt `frontend/AGENTS.md`. Pfade relativ zu
`frontend/src/`, sofern nicht `src/…` (Server).

**Kräfte-Zeitachse** (LFH-552, `openspec/changes/archive/2026-09-30-lfh-552-kraefte-zeitachse/design.md`,
Spec `kraefte-zeitachse`): Alarmierung/Eintreffen/Ablösung/Entlassung je Einheit und Person in
`einsatz_kraft_zeitachse` (append-only, Streichung mit Grund statt Löschen; Guard
`repo_ist_append_only`); Zeitpunkte der Zeitachse stehen nie als Spalten an den
Dispositionstabellen. Der Lebenszustand einer Zeile (`beendet_*`, `aufgeloest_*`, LLH-1079) ist
keine Zeitachse: Dauer und Perioden rechnen nur aus der Zeitachse. Einziger Schreibpfad
`zeitachse::repo::schreibe_tx` (Perioden-Regeln rein in `zeitachse/perioden.rs`; ein Verstoß
bricht nie den Statuswechsel). Ereignisse entstehen aus `zeitachse_marke` am Status-Katalog
(Bestand ohne Marke, nie aus dem Label raten), aus Ablösung, Nachtrag, Entlassen und dem
Eintreffen am Bereitstellungsraum (Quelle `bereitstellungsraum`, LLH-1075: nur Einheiten, ein
schon eingetroffenes Eintreffen wird ausgelassen, ohne die Buchung zu brechen; bewusste Ausnahme
zu „neue Einheiten bekommen kein Ereignis“ aus `kraefte-disposition`: die unangemeldet erfasste
Einheit beginnt ihre Periode mit diesem Eintreffen). Das Kennzeichen `uebernahme_offen_seit`
ist kein Zeitpunkt der Zeitachse. Ein Einheit-Ereignis gilt per Fan-out für die
JETZT zugeordneten Personen; Fahrzeuge wirken nur über ihre Einheit (erstes Fahrzeug bzw. alle für
die Entlassung). Eine Ablösung, auch ihre Fan-out-Kopie, streicht nur die Rücknahme des Vollzugs.
`schreibe_tx` koppelt an einer Einheit auch die Schicht (LLH-1128, `src/abloesung/kopplung.rs`):
Eintreffen der offenen Periode beginnt sie (nur mit Vorgabe, nie bei geerbter), eine Entlassung
ohne offene Periode danach beendet sie (`beendet`), die Streichung dieser Entlassung öffnet sie;
in einem Savepoint, ein Fehler bricht nie den Anlass. Ihre ETB-IDs trägt `Beruehrt::abloesung`,
jeder Aufrufer meldet sie nach dem Commit über `routes::abloesung::publish_kopplung`.
Dauern rechnet der Client (`kraefte/zeitachse.ts`), ohne Ereignis keine Zahl, keine Grenzwerte
(LFH-860). Anzeige im Meldebild/Personal/Einheit-Detail, **nicht im Stab**. Bewusster Bruch von
LFH-46 E17 (Feldbefund) auf Entscheidung vom 30.09.2026 — gilt nur hierfür.

**Ablösung** (LFH-635, LLH-1122, Spec `kraefte-abloesung`): Der Rhythmus einer Schicht folgt
der Rangfolge eigener Wert → Vorgabe des Abschnitts → Vorgabe des Einsatzes
(`rhythmus_quelle` `einheit`/`abschnitt`/`einsatz`). Die Vorgabe des Einsatzes ist eine Kopie
eines Schichtmodells (`einsatz_schichtmodell`), nie ein Verweis auf die Stammdaten: Ändern oder
Löschen eines Modells berührt keinen laufenden Einsatz. Die Rangfolge rechnet der Server beim
Beginnen; der Client zeigt sie nur (Karte „(Vorgabe Einsatz)“, Platzhalter über
`components/vorgabeText.ts`) und erlaubt ein leeres Rhythmusfeld, sobald eine Stufe darüber
greift. Die Vorwarnzeit kommt je Schicht aus dem DTO (`vorwarnung_minuten`, aus dem
Schichtmodell des Einsatzes), nie aus einer Konstante im Client (`abloesung/einstufung.ts`,
`abloesung/useUhr.ts`). Dauern stehen nur über `abloesung/dauer.ts` („8 h“, „7:30 h“, nie
Dezimal), Wechselzeiten taktisch, Regeltexte über `abloesung/schichtmodellText.ts`. Die Vorgabe
der Organisation wechselt in den zwei Schritten, die der Server verlangt, nur über
`api/schichtmodelle.ts:setOrgVorgabe`. **Knoten-Modell** (LLH-1118 Punkt 1): eine Untereinheit
ohne eigene laufende Schicht erbt die ihres nächsten Vorfahren; der Server ermittelt das beim
Lesen (`abloesung::vererbung`, DTO `erbende_einheiten` an der tragenden Schicht), der Client
rechnet keine Vererbung nach. Status `beendet` (mit `beendet_grund`) ist kein `laufend`: jede
Prüfung auf eine laufende Schicht vergleicht streng `status === 'laufend'`.
