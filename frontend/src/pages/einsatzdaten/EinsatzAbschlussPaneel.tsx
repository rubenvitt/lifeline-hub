import { Button } from 'antd';
import { useEffect, useState } from 'react';
import type { EinsatzAnzeige } from '../../api/types';
import { alsZeitpunkt } from '../../anzeige/zeitEingabe';
import ZeitAnzeige from '../../anzeige/ZeitAnzeige';
import { Paneel, Stapel, Textstufe, useRollen } from '../../components/instrument';
import {
  darfEinsatzLeiten,
  darfEinsatzWiedereroeffnen,
  wiedereroeffnenBis,
  type BenutzerOrgKontext,
} from '../../einsatz/schreibrecht';
import EinsatzAbschlussDialog from './EinsatzAbschlussDialog';
import EinsatzWiedereroeffnenDialog from './EinsatzWiedereroeffnenDialog';

/**
 * Paneel „Einsatzabschluss“, letzter Abschnitt der Einsatzdaten (LFH-960, LLH-1814, Spec
 * `bedien-wortlaut` und `einsatz-abschluss`, design.md D6). Unumkehrbares für den ganzen Einsatz
 * steht nicht im Kopf einer Arbeitsseite (`frontend/AGENTS.md`, „Destruktiv ist nicht gleich
 * destruktiv“).
 *
 * - **Aktiver Einsatz:** nur für die Einsatzleitung (`darfEinsatzLeiten`) „Einsatz abschließen…“,
 *   das den Dialog mit offenen Punkten und Eintippen öffnet. Für alle anderen fehlt das Paneel.
 * - **Abgeschlossener Einsatz:** für jeden, der die Seite liest, „Abgeschlossen am … von …“; für
 *   Einsatzleitung und System-Admin der Einsatz-Org binnen der Frist (`darfEinsatzWiedereroeffnen`)
 *   „Einsatz wieder öffnen…“ mit dem Ende der Frist. Am Fristende verschwindet der Knopf von selbst.
 *
 * Die Dialoge hängen nur, solange sie offen sind; der Aufrufer setzt `key` auf den Einsatz, damit
 * ein Einsatzwechsel offene Dialoge und ihre Gründe räumt. Ein offener Dialog folgt dem Zustand
 * des Einsatzes, den der Live-Kanal nachzieht: schließt jemand anderes ab, öffnet wieder oder
 * läuft die Frist ab, schließt er, statt eine Aktion anzubieten, die nicht mehr passt.
 */
export default function EinsatzAbschlussPaneel({
  einsatz,
  benutzer,
}: {
  einsatz: EinsatzAnzeige;
  benutzer: BenutzerOrgKontext;
}) {
  const { token } = useRollen();
  const [dialog, setDialog] = useState<'abschliessen' | 'wiedereroeffnen' | null>(null);
  const bis = wiedereroeffnenBis(einsatz);
  const jetzt = useJetztBisFristende(bis);
  const abgeschlossen = einsatz.status === 'abgeschlossen';

  const darfWiedereroeffnen = darfEinsatzWiedereroeffnen(einsatz, benutzer, jetzt);
  const darfAbschliessen = !abgeschlossen && darfEinsatzLeiten(einsatz);
  const passt =
    (dialog === 'abschliessen' && darfAbschliessen) ||
    (dialog === 'wiedereroeffnen' && darfWiedereroeffnen);
  // Passt der offene Dialog nicht mehr, ist er zu, und zwar endgültig: kehrt der Zustand später
  // zurück, öffnet er nicht von selbst wieder. Im selben Render schon nicht mehr gezeigt.
  useEffect(() => {
    if (dialog != null && !passt) setDialog(null);
  }, [dialog, passt]);

  if (!abgeschlossen && !darfEinsatzLeiten(einsatz)) return null;

  return (
    <Paneel titel="Einsatzabschluss" koerperPolster style={{ marginTop: token.marginLG }}>
      {abgeschlossen ? (
        <Stapel abstand="sm">
          <div data-lfh="abschluss-stand">
            <Textstufe als="p">
              Abgeschlossen am <ZeitAnzeige wert={einsatz.abgeschlossen_at} />
              {einsatz.abgeschlossen_von_name && <> von {einsatz.abgeschlossen_von_name}</>}
            </Textstufe>
          </div>
          {darfWiedereroeffnen && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                columnGap: token.margin,
                rowGap: token.marginXS,
              }}
            >
              <Button onClick={() => setDialog('wiedereroeffnen')}>Einsatz wieder öffnen…</Button>
              <span data-lfh="wiedereroeffnen-bis">
                <Textstufe stufe="meta" ton="gedaempft">
                  bis <ZeitAnzeige wert={bis} />
                </Textstufe>
              </span>
            </div>
          )}
        </Stapel>
      ) : (
        <Button danger onClick={() => setDialog('abschliessen')}>
          Einsatz abschließen…
        </Button>
      )}
      {passt && dialog === 'abschliessen' && (
        <EinsatzAbschlussDialog einsatz={einsatz} onSchliessen={() => setDialog(null)} />
      )}
      {passt && dialog === 'wiedereroeffnen' && (
        <EinsatzWiedereroeffnenDialog einsatzId={einsatz.id} onSchliessen={() => setDialog(null)} />
      )}
    </Paneel>
  );
}

/**
 * Die Uhr des Paneels in ms: gelesen beim Einhängen und einmal am Ende der Frist, damit
 * „Einsatz wieder öffnen…“ dann ohne neuen Abruf verschwindet. Sonst steht sie: nur dieser eine
 * Wechsel ändert, was das Paneel zeigt.
 */
function useJetztBisFristende(bis: string | null): number {
  const [jetzt, setJetzt] = useState(() => Date.now());
  useEffect(() => {
    const ende = alsZeitpunkt(bis)?.valueOf();
    if (ende == null) return;
    const rest = ende - Date.now();
    if (rest <= 0) return;
    // +50 ms: sicher HINTER der Grenze lesen; Timer über 2^31 - 1 ms liefen sofort ab.
    const t = window.setTimeout(() => setJetzt(Date.now()), Math.min(rest + 50, 2_147_483_647));
    return () => window.clearTimeout(t);
  }, [bis]);
  return jetzt;
}
