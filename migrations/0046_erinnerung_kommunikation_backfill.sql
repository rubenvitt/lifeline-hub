-- Retrofit LFH-84: bestehende Erinnerungen in die geteilte kommunikation_status
-- spiegeln. Mapping (alter Einzelstatus → zwei Achsen):
--   offen     → Quittung NULL, Vollzug 'offen'
--   quittiert → Quittung gesetzt (best-effort Zeitstempel), Vollzug 'offen'
--   erledigt  → Vollzug 'vollzogen' (vollzogen_at = erledigt_at), Quittung NULL
-- org_id wird aus dem zugehörigen Einsatz gejoint. quittiert_von/vollzogen_von
-- bleiben NULL (historischer Akteur nicht rekonstruierbar) — bewusste Näherung.
INSERT INTO kommunikation_status
    (org_id, einsatz_id, objekt_typ, objekt_id, quittiert_at, vollzug_status, vollzogen_at)
SELECT
    ein.org_id,
    e.einsatz_id,
    'erinnerung',
    e.id,
    CASE WHEN e.status = 'quittiert' THEN COALESCE(e.erledigt_at, e.erstellt_at) END,
    CASE WHEN e.status = 'erledigt' THEN 'vollzogen' ELSE 'offen' END,
    CASE WHEN e.status = 'erledigt' THEN e.erledigt_at END
FROM erinnerung e
JOIN einsatz ein ON ein.id = e.einsatz_id;
