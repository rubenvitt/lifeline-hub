# Kräfte-Zeitachse — Regeln

Gilt für `kraefte/zeitachse.ts`, `kraefte/KraftZeitachse.tsx`, `src/zeitachse/`,
`src/routes/zeitachse.rs` und jede Stelle, die einen Statuswechsel, eine Disposition oder die
Ablösung schreibt (sie schreiben die Zeitachse mit); ergänzt `frontend/AGENTS.md`. Pfade relativ
zu `frontend/src/`, sofern nicht `src/…` (Server).

**Kräfte-Zeitachse** (LFH-552, `openspec/changes/archive/2026-09-30-lfh-552-kraefte-zeitachse/design.md`,
Spec `kraefte-zeitachse`): Alarmierung/Eintreffen/Ablösung/Entlassung je Einheit und Person in
`einsatz_kraft_zeitachse` (append-only, Streichung mit Grund statt Löschen; Guard
`repo_ist_append_only`), nie als Spalten an den Dispositionstabellen. Einziger Schreibpfad
`zeitachse::repo::schreibe_tx` (Perioden-Regeln rein in `zeitachse/perioden.rs`; ein Verstoß
bricht nie den Statuswechsel). Ereignisse entstehen aus `zeitachse_marke` am Status-Katalog
(Bestand ohne Marke, nie aus dem Label raten), ein Einheit-Ereignis gilt per Fan-out für die
JETZT zugeordneten Personen; Fahrzeuge wirken nur über ihre Einheit (erstes Fahrzeug bzw. alle für
die Entlassung). Eine Ablösung, auch ihre Fan-out-Kopie, streicht nur die Rücknahme des Vollzugs.
Dauern rechnet der Client (`kraefte/zeitachse.ts`), ohne Ereignis keine Zahl, keine Grenzwerte
(LFH-860). Anzeige im Meldebild/Personal/Einheit-Detail, **nicht im Stab**. Bewusster Bruch von
LFH-46 E17 (Feldbefund) auf Entscheidung vom 30.09.2026 — gilt nur hierfür.
