import Platzhalter from '../components/Platzhalter';
import type { ModulEintrag } from './modulRegistry';

/** Stub-Seite für geplante/WIP-Module. Route existiert, Inhalt ist Platzhalter. */
export default function ModulStub({ modul }: { modul: ModulEintrag }) {
  return <Platzhalter titel={modul.label} beschreibung={modul.beschreibung} />;
}
