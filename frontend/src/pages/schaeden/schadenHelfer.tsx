import { Link } from 'react-router';
import { Tag, Typography } from 'antd';
import { personDetailPfad, personalPfad } from '../../routing/deeplinks';
import type {
  Ausmass,
  Schaden,
  SchadenAbschlussGrund,
  SchadenStatus,
  SchadenTyp,
} from '../../api/types';
import type { GeschaedigtWert } from './GeschaedigtPicker';

// Gemeinsame Anzeige-/Mapping-Helfer für Schäden-Liste (SchaedenPage) und
// -Detailseite (SchaedenDetailPage). Insbesondere die Geschädigt-XOR-Abbildung auf die
// vier Backend-Felder liegt damit an EINER Stelle (sonst fehleranfällig dupliziert).

export const STATUS_META: Record<SchadenStatus, { label: string; color: string }> = {
  offen: { label: 'offen', color: 'gold' },
  uebergeben: { label: 'übergeben', color: 'blue' },
  abgeschlossen: { label: 'abgeschlossen', color: 'default' },
};

export const TYP_LABEL: Record<SchadenTyp, string> = {
  sachschaden: 'Sachschaden',
  verkehrshindernis: 'Verkehrshindernis',
  infrastruktur: 'Infrastruktur',
  umweltschaden: 'Umweltschaden',
  tierkadaver: 'Tierkadaver',
  sonstige: 'Sonstige',
};

export const AUSMASS_META: Record<Ausmass, { label: string; color: string }> = {
  gering: { label: 'gering', color: 'green' },
  mittel: { label: 'mittel', color: 'gold' },
  gross: { label: 'groß', color: 'orange' },
  katastrophal: { label: 'katastrophal', color: 'red' },
};

export const ABSCHLUSS_LABEL: Record<SchadenAbschlussGrund, string> = {
  behoben: 'behoben',
  kein_handlungsbedarf: 'kein Handlungsbedarf',
  abgewiesen: 'abgewiesen',
};

export const ABSCHLUSS_GRUENDE = (Object.keys(ABSCHLUSS_LABEL) as SchadenAbschlussGrund[]).map((g) => ({
  value: g,
  label: ABSCHLUSS_LABEL[g],
}));

export function pad3(nr: number): string {
  return String(nr).padStart(3, '0');
}

/** Reine Filterkette der Schäden-Liste: Sicht (Status oder „alle"), Typ, Ausmaß und
 *  Freitextsuche über Ort/Beschreibung. Testbar ohne Rendern (SchaedenPage verdrahtet die
 *  UI-Filter-States hierher). */
export function filterSchaeden(
  alle: Schaden[],
  opts: { sicht: SchadenStatus | 'alle'; typ?: SchadenTyp; ausmass?: Ausmass; suche: string },
): Schaden[] {
  const { sicht, typ, ausmass, suche } = opts;
  return alle
    .filter((s) => sicht === 'alle' || s.status === sicht)
    .filter((s) => !typ || s.typ === typ)
    .filter((s) => !ausmass || s.ausmass === ausmass)
    .filter((s) => {
      if (!suche.trim()) return true;
      const q = suche.toLowerCase();
      return s.ort.toLowerCase().includes(q) || s.beschreibung.toLowerCase().includes(q);
    });
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
      <Link to={personDetailPfad(einsatzId, s.geschaedigt_person_id)}><Tag color="blue">{label}</Tag></Link>
    ) : (
      <Tag color="blue">{label}</Tag>
    );
  }
  if (s.geschaedigt_personal_id != null) {
    // Einsatzkraft → Personal-Liste mit Zeilen-Selektion (?personal=, LFH-25).
    return (
      <Link to={personalPfad(einsatzId, { personal: s.geschaedigt_personal_id })}>
        <Tag color="geekblue">{s.geschaedigt_personal_name ?? 'Einsatzkraft'}</Tag>
      </Link>
    );
  }
  if (s.geschaedigt_organisation_id != null) {
    return <Tag color="purple">{s.geschaedigt_organisation_name ?? 'Eigene Organisation'}</Tag>;
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
        s.geschaedigt_registrier_nr != null ? `R-${pad3(s.geschaedigt_registrier_nr)}` : 'Betroffene Person',
    };
  }
  if (s.geschaedigt_personal_id != null) {
    return { typ: 'personal', refId: s.geschaedigt_personal_id, label: s.geschaedigt_personal_name ?? 'Einsatzkraft' };
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
