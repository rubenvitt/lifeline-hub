import { Button, Space, Spin, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { useOnline } from '../offline/useOnline';
import { GERAET_START_PFAD, KOPPELN_PFAD } from '../routing/deeplinks';
import { GeraeteKarte } from './GeraeteKarte';

/**
 * „Kopplung beendet“ statt der Anmeldung (LFH-892, Spec `feldgeraet-bedienung`): Ziel jedes 401
 * eines Geräts. Keine Anmeldemaske für Personen; der einzige Weg weiter ist ein neuer Code.
 *
 * Ohne Netz lässt sich nicht unterscheiden, ob die Kopplung endete oder nur die Verbindung fehlt
 * (ein Gerät hält kein Lagebild vor, design.md D8). Die Seite sagt das und prüft von selbst,
 * sobald das Netz zurück ist.
 */
export default function KopplungBeendetPage() {
  const { benutzer, geraet, laedt, aktualisiere } = useAuth();
  const online = useOnline();
  const navigate = useNavigate();
  const [prueft, setPrueft] = useState(false);

  function pruefen() {
    setPrueft(true);
    aktualisiere()
      .catch(() => undefined)
      .finally(() => setPrueft(false));
  }

  useEffect(() => {
    if (!online) return;
    aktualisiere().catch(() => undefined);
  }, [online, aktualisiere]);

  if (laedt) {
    return (
      <GeraeteKarte untertitel="Gerät">
        <Spin />
      </GeraeteKarte>
    );
  }
  // Die Kopplung besteht doch (wieder): zurück auf die Hülle. Eine Person gehört nicht hierher.
  if (geraet) return <Navigate to={GERAET_START_PFAD} replace />;
  if (benutzer) return <Navigate to="/einsaetze" replace />;

  return (
    <GeraeteKarte untertitel="Gerät">
      <Typography.Title level={2} style={{ fontSize: 20, marginTop: 0 }}>
        {online ? 'Kopplung beendet' : 'Keine Verbindung'}
      </Typography.Title>
      {online && <Typography.Paragraph>Neuen Code gibt die Einsatzleitung.</Typography.Paragraph>}
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        <Button type="primary" size="large" block onClick={() => navigate(KOPPELN_PFAD)}>
          Neuen Code eingeben
        </Button>
        <Button size="large" block loading={prueft} onClick={pruefen}>
          Erneut prüfen
        </Button>
      </Space>
    </GeraeteKarte>
  );
}
