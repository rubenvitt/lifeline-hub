import { Collapse, Typography } from 'antd';
import { memo } from 'react';
import type { Auftrag, AuftragEmpfaenger as AuftragEmpfaengerTyp } from '../api/types';
import KommKarte from '../kommunikation/KommKarte';
import type { ZeilenGrund } from '../components/useZeilenFehler';
import {
  AuftragEmpfaenger,
  AuftragHandlungen,
  AuftragKopf,
  AuftragSchema,
  AuftragVollzug,
  AuftragZeit,
  auftragKante,
  auftragKennung,
  gefuellteFelder,
} from './AuftragTeile';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';

const { Text } = Typography;

interface AuftragKarteProps {
  auftrag: Auftrag;
  ansicht?: 'offen' | 'abgeschlossen';
  einsatzId?: number;
  darfSchreiben?: boolean;
  /** Deeplink-Hervorhebung (?auftrag=): markierte Karte, scroll-adressierbar. */
  hervorgehoben?: boolean;
  quittierungLaeuft?: boolean;
  quittierungZiel?: { auftragId: number; empfaengerId: number } | null;
  onQuittieren?: (auftragId: number, empfaengerId: number) => void;
  /** Welche Empfängerzeilen quittierbar sind; ohne: alle (ein Abschnittsgerät nur seine). */
  darfQuittierenFuer?: (empfaenger: AuftragEmpfaengerTyp) => boolean;
  onInArbeit?: (auftragId: number) => void;
  onVollzugMelden?: (auftragId: number) => void;
  onAbnehmen?: (auftragId: number) => void;
  /**
   * Grund der zuletzt abgelehnten Karten-Aktion (In Bearbeitung, Rücknahme, Abnahme), aus
   * `components/useZeilenFehler.ts`. Ein stabiles Objekt je Grund, die Karte bleibt `memo`.
   */
  fehlerGrund?: ZeilenGrund | null;
  /** Grund der zuletzt abgelehnten Quittung an dieser Karte; steht an der Empfängerzeile. */
  quittierFehlerGrund?: ZeilenGrund | null;
}

/**
 * Auftrags-Karte mit allem in der Karte: Geräteansicht und Palette-Vorschau. Die Seite
 * „Aufträge/Befehle“ trennt Liste und Detail (`AuftragListenKarte`, `AuftragDetail`); alle drei
 * setzen dieselben Teile aus `AuftragTeile.tsx` zusammen. `memo` (LFH-949, D6): ein Live-Ereignis
 * mit einem geänderten Auftrag rendert nur dessen Karte; die Handler der Liste sind dafür stabil.
 */
export default memo(AuftragKarte);

function AuftragKarte({
  auftrag: a,
  ansicht = 'offen',
  einsatzId,
  darfSchreiben,
  hervorgehoben,
  quittierungLaeuft,
  quittierungZiel,
  onQuittieren,
  darfQuittierenFuer,
  onInArbeit,
  onVollzugMelden,
  onAbnehmen,
  fehlerGrund,
  quittierFehlerGrund,
}: AuftragKarteProps) {
  const { formatZeit } = useAnzeigeKonventionen();
  const hatSchema = gefuellteFelder(a, formatZeit).length > 0;

  return (
    // Erteilungszeit links in Mono, darunter die Nummer; überfällig schlägt „offen" am Rand.
    <KommKarte
      data-auftrag-id={a.id}
      data-ueberfaellig={a.ist_ueberfaellig ? 'true' : undefined}
      {...auftragKante(a)}
      hervorgehoben={hervorgehoben}
      zeit={<AuftragZeit auftrag={a} />}
      nr={auftragKennung(a)}
    >
      <AuftragKopf auftrag={a} einsatzId={einsatzId} />

      <Text strong style={{ fontSize: 15, lineHeight: 1.4, display: 'block', marginBottom: 8 }}>
        {a.auftrag_text}
      </Text>

      <AuftragEmpfaenger
        auftrag={a}
        darfSchreiben={darfSchreiben}
        quittierungLaeuft={quittierungLaeuft}
        quittierungZiel={quittierungZiel}
        onQuittieren={onQuittieren}
        darfQuittierenFuer={darfQuittierenFuer}
        quittierFehlerGrund={quittierFehlerGrund}
      />

      <AuftragVollzug auftrag={a} ansicht={ansicht} />

      {hatSchema && (
        <Collapse
          ghost
          style={{ marginInline: -8 }}
          items={[
            {
              key: 'details',
              // „Auftrag", nicht „Befehl": ein Befehl ist auf dieser Seite das Dokument im
              // Nachbarreiter (LFH-972). „Schema" meint das Befehlsschema als Fachbegriff.
              label: 'Auftragsdetails (Schema)',
              children: <AuftragSchema auftrag={a} />,
            },
          ]}
        />
      )}

      <AuftragHandlungen
        auftrag={a}
        darfSchreiben={darfSchreiben}
        onInArbeit={onInArbeit}
        onVollzugMelden={onVollzugMelden}
        onAbnehmen={onAbnehmen}
        fehlerGrund={fehlerGrund}
      />
    </KommKarte>
  );
}
