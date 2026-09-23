import { Typography } from 'antd';
import EinsatzSeite from '../components/EinsatzSeite';

/**
 * Fachmodul Betreuung (LFH-639) — ROHBAU aus Gruppe 3 („Frontend: Unterbau").
 *
 * Diese Datei trägt nur die Route: Registry-Eintrag, `MODUL_ELEMENTE` in `App.tsx` und der
 * Backend-Drift-Test `backend_modul_keys_decken_frontend_registry` brauchen ein Element, und
 * ohne Element fiele `App.tsx` auf den `ModulStub` zurück. Die eigentliche Seite (Blöcke
 * „Evakuierung" und „Betreuungsstellen", Dialoge, Rückgängig) baut Gruppe 4 (tasks.md 4.1–4.3)
 * auf dem Unterbau aus `api/betreuung.ts`, `betreuung/evakuierungKennzahl.ts`,
 * `theme/statusFarben.ts` (`raeumungszustand`, `betreuungsstelleStatus`, `auslastung`) und
 * `routing/deeplinks.ts` (`betreuungPfad`) und ersetzt diesen Inhalt.
 */
export default function BetreuungPage() {
  return (
    <EinsatzSeite titel="Betreuung">
      <Typography.Text type="secondary">
        Evakuierungsbezirke und Betreuungsstellen dieses Einsatzes.
      </Typography.Text>
    </EinsatzSeite>
  );
}
