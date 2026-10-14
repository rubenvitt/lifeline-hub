import { Space } from 'antd';
import { Link } from 'react-router';
import type { EinsatzMaterial } from '../api/types';
import { useRollen } from '../components/instrument';
import { useSprungSperre } from '../einsatz/useSprungSperre';
import { verdichteMaterial } from './materialVerdichtungKern';
import { verdichtungsLinkStil, verdichtungsTextfarbe } from './Verdichtungszeile';

/**
 * Die Materialaussage über der Materialliste (LLH-1093, design.md D10): „7 einsatzbereit · 3 im
 * Einsatz · 2 Ausfall“, gezählt in Posten über `verdichteMaterial` (dieselbe Zählung wie die
 * Material-Gruppenzeile im Meldebild). Sie steht an der Stelle der `Verdichtungszeile`, die auf
 * der Materialseite Personal und Fahrzeuge zählte. Die Gesamtzahl steht einmal, im Seitenkopf.
 *
 * Zahl vor Wort; nur Ausfall wird getönt und nur bei mehr als null, mit der Textrolle des
 * schwersten Status im Topf (Muster `verdichtungsTextfarbe`), das Wort ist der zweite Kanal.
 * Einsatzbereit und im Einsatz sind der Normalfall und bleiben ohne Farbe.
 *
 * Gezählt wird, was der Aufrufer hereinreicht: die ganze aktive Liste, nicht die gefilterte. Ohne
 * Daten (Laden, erster Fehler) behauptet die Zeile keine Null: sie hält nur ihren Platz, unsichtbar
 * und für Hilfsmittel verborgen. Erschiene sie erst mit den Daten, schöbe sie die Liste darunter
 * nach unten (CLS 0,10–0,13 bei 1024 und 390 px, Prüfliste LLH-1093, Kriterium 12).
 */
export default function MaterialVerdichtung({
  einsatzId,
  material,
  pfad,
}: {
  einsatzId: number;
  material: readonly EinsatzMaterial[] | undefined;
  pfad: string;
}) {
  const { token, rollen } = useRollen();
  const meldebildGesperrt = useSprungSperre(einsatzId)('kraefteuebersicht');
  const platzhalter = material == null;
  const v = verdichteMaterial(material ?? []);
  return (
    <Space
      wrap
      align="center"
      data-testid={platzhalter ? 'material-verdichtung-platz' : 'material-verdichtung'}
      data-lfh={platzhalter ? undefined : 'verdichtungszeile'}
      aria-hidden={platzhalter || undefined}
      style={{
        marginBlockEnd: token.margin,
        ...(platzhalter ? { visibility: 'hidden' as const } : {}),
      }}
    >
      <span>{v.einsatzbereit} einsatzbereit</span>
      <span aria-hidden>·</span>
      <span>{v.imEinsatz} im Einsatz</span>
      <span aria-hidden>·</span>
      <span
        data-ton={v.ausfallRolle ?? undefined}
        style={
          v.ausfallRolle ? { color: verdichtungsTextfarbe(rollen, v.ausfallRolle) } : undefined
        }
      >
        {v.ausfall} Ausfall
      </span>
      {!meldebildGesperrt && (
        <Link to={pfad} style={verdichtungsLinkStil(token)}>
          Meldebild
        </Link>
      )}
    </Space>
  );
}
