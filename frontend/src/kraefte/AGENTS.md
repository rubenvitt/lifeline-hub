# Kräfte-Zeitachse — Regeln

Gilt für `kraefte/zeitachse.ts`, `kraefte/KraftZeitachse.tsx`, `src/zeitachse/`,
`src/routes/zeitachse.rs` und jede Stelle, die einen Statuswechsel, eine Disposition, die
Ablösung oder das Eintreffen am Bereitstellungsraum schreibt (sie schreiben die Zeitachse mit);
ergänzt `frontend/AGENTS.md`. Pfade relativ zu `frontend/src/`, sofern nicht `src/…` (Server).

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
Dauern rechnet der Client (`kraefte/zeitachse.ts`), ohne Ereignis keine Zahl, keine Grenzwerte
(LFH-860). Anzeige im Meldebild/Personal/Einheit-Detail, **nicht im Stab**. Bewusster Bruch von
LFH-46 E17 (Feldbefund) auf Entscheidung vom 30.09.2026 — gilt nur hierfür.
