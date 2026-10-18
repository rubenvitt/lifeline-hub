import { Alert, Button, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { IconPersonPlus } from '../icons';
import { useAuth } from '../auth/AuthContext';
import { listePersonen } from '../api/einsatzPerson';
import { ladeUhs } from '../api/einsatzUhs';
import { einsatzKeys } from '../api/queryKeys';
import type { Person, UhsDetail } from '../api/types';
import Datensicht, { spaltenFuer } from '../components/Datensicht';
import EinsatzSeite from '../components/EinsatzSeite';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import { useRollen } from '../components/instrument';
import {
  personenKarte,
  personenSpalten,
  seitWert,
  verbleibText,
} from '../personen/personenSpalten';
import { geraetAufnahmePfad, geraetPersonPfad } from '../routing/deeplinks';
import { dringlichkeitsWert, wartetSeit } from '../pages/uhs/dringlichkeit';

/**
 * Spalten des Registers, die das Tablet zeigt; Fundort und Vermerk stehen im Detail. Der Zustand
 * steht dabei (LLH-1135): wer als Nächstes auf einen Platz kommt, entscheidet sich an Sichtung und
 * Zustand.
 */
const GERAET_SPALTEN = new Set(['reg', 'person', 'sk', 'zustand', 'seit']);

/** Zustand in Kurzform: eine Zeile, Längeres endet mit „…“ und steht ganz im Tooltip. */
function ZustandKurz({ zustand }: { zustand: string | null | undefined }) {
  const { rollen } = useRollen();
  if (!zustand) return <span style={{ color: rollen.schwach }}>—</span>;
  return (
    <Typography.Text ellipsis={{ tooltip: zustand }} style={{ fontSize: 12, color: rollen.text2 }}>
      {zustand}
    </Typography.Text>
  );
}

const IN_DER_UHS = 'hier';
const AUSGETRETEN = 'weg';

/**
 * Wo die Person in dieser UHS steht: Wartebereich, ihr Platz, oder — nach dem Austritt — ihr
 * Verbleib. Rein, damit die Liste und ihr Test dieselbe Antwort lesen.
 */
export function ortInDerUhs(p: Person, uhs: UhsDetail | undefined): string {
  if (uhs && p.aktuelle_uhs_id === uhs.id) {
    if (p.aktueller_platz_id == null) return 'Wartebereich';
    return uhs.plaetze.find((pl) => pl.id === p.aktueller_platz_id)?.bezeichnung ?? 'Platz';
  }
  return verbleibText(p, () => undefined) ?? 'ausgetreten';
}

/**
 * Startseite von UHS-Tablet und UHS-Laptop (LFH-892, Spec `feldgeraet-bedienung`, „Start am
 * Tablet“): die Patienten der eigenen UHS mit „Patient aufnehmen“ als Primäraktion. Der Server
 * liefert nur Personen, die je in dieser UHS lagen; wer ausgetreten ist, steht in der zweiten
 * Gruppe mit seinem Verbleib.
 */
export default function GeraetPatientenPage() {
  const { geraet } = useAuth();
  const navigate = useNavigate();
  const einsatzId = geraet?.einsatz_id ?? 0;
  const uhsId = geraet?.uhs_id ?? null;

  const personenQuery = useQuery({
    queryKey: einsatzKeys.personen(einsatzId),
    queryFn: () => listePersonen(einsatzId),
    enabled: geraet != null,
  });
  const uhsQuery = useQuery({
    queryKey: einsatzKeys.uhsDetail(einsatzId, uhsId ?? 0),
    queryFn: () => ladeUhs(einsatzId, uhsId!),
    enabled: geraet != null && uhsId != null,
  });
  const uhs = uhsQuery.data;

  const register = personenSpalten((id) => (id === uhs?.id ? uhs.bezeichnung : undefined));
  /*
   * Vorgabe-Sortierung nach Dringlichkeit (LLH-1135, `pages/uhs/dringlichkeit.ts`, dieselbe Reihe
   * wie Wartebereich und Zuweisung): die Sichtungsspalte sortiert nach Reihe und Wartezeit seit
   * dem Eintritt (bzw. der Rückkehr in den Wartebereich); ohne Belegung zählt die Sichtung oder
   * Erfassung. Den Zufluss hält die Schleuse der `Datensicht`.
   */
  const dringlichkeit = (p: Person) =>
    dringlichkeitsWert({
      sichtung: p.aktuelle_sichtung,
      seit: (uhs ? wartetSeit(p.id, uhs.belegungen) : null) ?? seitWert(p),
    });
  const spalten = spaltenFuer<Person>()([
    ...register
      .filter((s) => GERAET_SPALTEN.has(s.key))
      .map((s): (typeof register)[number] =>
        s.key === 'sk'
          ? { ...s, sortWert: dringlichkeit }
          : s.key === 'zustand'
            ? { ...s, render: (_: unknown, p: Person) => <ZustandKurz zustand={p.zustand} /> }
            : s,
      ),
    {
      title: 'Platz',
      key: 'ort',
      width: 160,
      immerSichtbar: true,
      suchText: (p) => ortInDerUhs(p, uhs),
      render: (_, p) => ortInDerUhs(p, uhs),
    },
  ]);

  const aufnahme = uhsId != null ? geraetAufnahmePfad(einsatzId, { uhs: uhsId }) : null;

  return (
    <EinsatzSeite
      titel="Patienten"
      meta={uhs?.bezeichnung}
      dataUpdatedAt={gemeinsamerDatenstand(personenQuery.dataUpdatedAt, uhsQuery.dataUpdatedAt)}
      aktionen={
        aufnahme && (
          <Button type="primary" icon={<IconPersonPlus />} onClick={() => navigate(aufnahme)}>
            Patient aufnehmen
          </Button>
        )
      }
    >
      {personenQuery.isError ? (
        <Alert type="error" showIcon title="Patienten konnten nicht geladen werden" />
      ) : (
        <Datensicht
          bezeichnung="Patienten"
          spalten={spalten}
          daten={(personenQuery.data ?? []).filter((p) => !p.storniert_at)}
          zeilenSchluessel="id"
          ladend={personenQuery.isLoading}
          leerText="Noch keine Patienten in dieser Unfallhilfsstelle"
          suche={{ platzhalter: 'R-Nr., Name' }}
          standardSortierung={{ spalte: 'sk', richtung: 'auf' }}
          gruppen={{
            schluessel: (p) => (uhs && p.aktuelle_uhs_id === uhs.id ? IN_DER_UHS : AUSGETRETEN),
            etikett: (g) => (g === IN_DER_UHS ? 'In der UHS' : 'Ausgetreten'),
            reihenfolge: [IN_DER_UHS, AUSGETRETEN],
            unterEbene: 1,
          }}
          onZeileKlick={(p) => navigate(geraetPersonPfad(einsatzId, p.id))}
          karte={{
            ...personenKarte(einsatzId),
            titel: { spalte: 'reg', ziel: (p) => geraetPersonPfad(einsatzId, p.id) },
            // Höchstens drei Felder: der Zustand steht in der Kartenform nicht (Tablet zeigt die Tabelle).
            sekundaer: ['person', 'sk', 'ort'],
          }}
        />
      )}
    </EinsatzSeite>
  );
}
