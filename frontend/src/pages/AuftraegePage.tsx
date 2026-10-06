import { Alert, Breadcrumb, Spin, Tabs, Typography } from 'antd';
import { Link, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { einsatzKeys } from '../api/queryKeys';
import AuftraegeListe from '../auftraege/AuftraegeListe';
import BefehlListe from '../auftraege/BefehlListe';
import EinsatzSeite from '../components/EinsatzSeite';
import { parseAuftraegeReiter, type AuftraegeReiter } from '../routing/deeplinks';

/**
 * Abgrenzung der zwei Objekte dieser Seite (LFH-972): ein Auftrag geht einzeln an einen Empfänger
 * und wird quittiert und vollzogen; ein Befehl ist ein Dokument mit Fassungen und Freigabe. Ohne
 * diese Zeile wählte ein Helfer, der „einem Zug einen Befehl geben" will, den falschen Reiter.
 */
const ABGRENZUNG: Record<AuftraegeReiter, string> = {
  auftraege: 'Einzelauftrag an Abschnitt oder Einheit, mit Quittung und Vollzug.',
  befehle: 'Schriftlicher Einsatzbefehl, wird freigegeben und gedruckt.',
};

function Abgrenzung({ reiter }: { reiter: AuftraegeReiter }) {
  return (
    <Typography.Paragraph type="secondary" data-lfh="reiter-abgrenzung">
      {ABGRENZUNG[reiter]}
    </Typography.Paragraph>
  );
}

export default function AuftraegePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  // Der Reiter ist Zustand der Adresse (`auftraegePfad`, `reiter`): Brotkrume und Browser-Zurück
  // aus einem Befehl landen so auf „Befehle", nicht auf der Vorgabe.
  const [searchParams, setSearchParams] = useSearchParams();
  const reiter = parseAuftraegeReiter(searchParams);
  const reiterWechseln = (neu: string) =>
    setSearchParams(
      (alt) => {
        const naechste = new URLSearchParams(alt);
        if (neu === 'befehle') naechste.set('reiter', 'befehle');
        else naechste.delete('reiter');
        return naechste;
      },
      // Kein History-Eintrag je Reiterwechsel: Zurück führt aus der Seite, nicht durch die Reiter.
      { replace: true },
    );

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });

  if (einsatzQuery.isLoading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  return (
    // Titel und Ortspfad trägt der Seitenkopf; Mengen, Datenstand und Anlegen-Aktion
    // gehören dem jeweiligen Reiter (`Bereichskopf`) — die zwei Bereiche zählen Verschiedenes.
    <EinsatzSeite
      titel="Aufträge/Befehle"

      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: 'Aufträge/Befehle' },
          ]}
        />
      }
    >
      <Tabs
        activeKey={reiter}
        onChange={reiterWechseln}
        items={[
          {
            key: 'auftraege',
            label: 'Aufträge',
            children: (
              <>
                <Abgrenzung reiter="auftraege" />
                <AuftraegeListe einsatzId={einsatzId} darfSchreiben={darfSchreiben} />
              </>
            ),
          },
          {
            key: 'befehle',
            label: 'Befehle',
            children: (
              <>
                <Abgrenzung reiter="befehle" />
                <BefehlListe einsatzId={einsatzId} darfSchreiben={darfSchreiben} />
              </>
            ),
          },
        ]}
      />
    </EinsatzSeite>
  );
}
