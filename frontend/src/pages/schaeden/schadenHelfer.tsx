import { Link } from 'react-router';
import { Typography } from 'antd';
import StatusTag from '../../components/StatusTag';
import { bezugsDarstellung } from '../../theme/statusFarben';
import { personDetailPfad, personalPfad } from '../../routing/deeplinks';
import type { Schaden, SchadenAbschlussGrund, SchadenStatus, SchadenTyp } from '../../api/types';
import type { GeschaedigtWert } from './GeschaedigtPicker';

// Gemeinsame Anzeige-/Mapping-Helfer für Schäden-Liste (SchaedenPage) und
// -Detailseite (SchaedenDetailPage). Insbesondere die Geschädigt-XOR-Abbildung auf die
// vier Backend-Felder liegt damit an EINER Stelle (sonst fehleranfällig dupliziert).

export {
  schadenStatus as STATUS_META,
  schadenAusmass as AUSMASS_META,
} from '../../theme/statusFarben';

export const TYP_LABEL: Record<SchadenTyp, string> = {
  sachschaden: 'Sachschaden',
  verkehrshindernis: 'Verkehrshindernis',
  infrastruktur: 'Infrastruktur',
  umweltschaden: 'Umweltschaden',
  tierkadaver: 'Tierkadaver',
  sonstige: 'Sonstige',
};

export const ABSCHLUSS_LABEL: Record<SchadenAbschlussGrund, string> = {
  behoben: 'behoben',
  kein_handlungsbedarf: 'kein Handlungsbedarf',
  abgewiesen: 'abgewiesen',
};

export const ABSCHLUSS_GRUENDE = (Object.keys(ABSCHLUSS_LABEL) as SchadenAbschlussGrund[]).map(
  (g) => ({
    value: g,
    label: ABSCHLUSS_LABEL[g],
  }),
);

export function pad3(nr: number): string {
  return String(nr).padStart(3, '0');
}

/** Reiterachse der Schäden-Liste: Status oder „alle".
 *
 *  SEIT LFH-340 · C5 nur noch das. Typ, Ausmaß und Freitextsuche lagen bis dahin ebenfalls
 *  hier und wurden aus drei Bedienelementen über der Tabelle gespeist; sie sind in das
 *  `Datensicht`-Primitiv gewandert (Spaltenfilter bzw. `suche`), das beides mitbringt.
 *  Zwei Filterketten übereinander wären eine, die niemand mehr überblickt. */
export function filterSchaeden(
  alle: Schaden[],
  opts: { sicht: SchadenStatus | 'alle' },
): Schaden[] {
  return alle.filter((s) => opts.sicht === 'alle' || s.status === opts.sicht);
}

/** Kompakte Geschädigt-Anzeige inkl. Deeplinks (Person→Detailseite, Einsatzkraft→Personal-Liste). */
export function geschaedigtAnzeige(s: Schaden, einsatzId: number): React.ReactNode {
  if (s.geschaedigt_registrier_nr != null) {
    const label = `R-${pad3(s.geschaedigt_registrier_nr)}`;
    // Storniert bleibt grauer Text ohne Deeplink (Status-quo-Optik).
    if (s.geschaedigt_storniert_at) {
      return <Typography.Text type="secondary">Geschädigt (storniert): {label}</Typography.Text>;
    }
    // Deeplink auf die Personen-Detailseite (LFH-25), falls die Person-id bekannt ist.
    return s.geschaedigt_person_id != null ? (
      <Link to={personDetailPfad(einsatzId, s.geschaedigt_person_id)}>
        <StatusTag darstellung={bezugsDarstellung(label)} />
      </Link>
    ) : (
      <StatusTag darstellung={bezugsDarstellung(label)} />
    );
  }
  if (s.geschaedigt_personal_id != null) {
    // Einsatzkraft → Personal-Liste mit Zeilen-Selektion (?personal=, LFH-25).
    return (
      <Link to={personalPfad(einsatzId, { personal: s.geschaedigt_personal_id })}>
        <StatusTag darstellung={bezugsDarstellung(s.geschaedigt_personal_name ?? 'Einsatzkraft')} />
      </Link>
    );
  }
  if (s.geschaedigt_organisation_id != null) {
    return (
      <StatusTag
        darstellung={bezugsDarstellung(s.geschaedigt_organisation_name ?? 'Eigene Organisation')}
      />
    );
  }
  if (s.geschaedigt_kontakt) return <Typography.Text>{s.geschaedigt_kontakt}</Typography.Text>;
  return <Typography.Text type="secondary">—</Typography.Text>;
}

/** Strukturierten Geschädigt-Wert aus einem geladenen Schaden ableiten (Edit-Seeding). */
export function geschaedigtAusSchaden(s: Schaden): GeschaedigtWert {
  if (s.geschaedigt_person_id != null) {
    return {
      typ: 'person',
      refId: s.geschaedigt_person_id,
      label:
        s.geschaedigt_registrier_nr != null
          ? `R-${pad3(s.geschaedigt_registrier_nr)}`
          : 'Betroffene Person',
    };
  }
  if (s.geschaedigt_personal_id != null) {
    return {
      typ: 'personal',
      refId: s.geschaedigt_personal_id,
      label: s.geschaedigt_personal_name ?? 'Einsatzkraft',
    };
  }
  if (s.geschaedigt_organisation_id != null) {
    return { typ: 'organisation', label: s.geschaedigt_organisation_name ?? 'Eigene Organisation' };
  }
  if (s.geschaedigt_kontakt) return { typ: 'extern', kontakt: s.geschaedigt_kontakt };
  return null;
}

/** GeschaedigtWert → die vier Backend-Felder (genau eines gesetzt). orgId für die eigene Org. */
export function geschaedigtFelder(
  wert: GeschaedigtWert,
  orgId: number,
): {
  geschaedigt_person_id: number | null;
  geschaedigt_personal_id: number | null;
  geschaedigt_organisation_id: number | null;
  geschaedigt_kontakt: string | null;
} {
  const leer = {
    geschaedigt_person_id: null,
    geschaedigt_personal_id: null,
    geschaedigt_organisation_id: null,
    geschaedigt_kontakt: null,
  };
  if (wert == null) return leer;
  switch (wert.typ) {
    case 'person':
      return { ...leer, geschaedigt_person_id: wert.refId };
    case 'personal':
      return { ...leer, geschaedigt_personal_id: wert.refId };
    case 'organisation':
      return { ...leer, geschaedigt_organisation_id: orgId };
    case 'extern':
      return { ...leer, geschaedigt_kontakt: wert.kontakt };
  }
}
