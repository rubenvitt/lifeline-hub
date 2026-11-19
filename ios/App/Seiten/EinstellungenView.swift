import LifelineKern
import SwiftUI

/// Einstellungen der Hülle (Spec `ios-huelle`, „Haptik nur auf Wunsch der Seite und
/// abschaltbar“). Nur Schalter der Hülle; Einstellungen der Oberfläche stehen in der Oberfläche.
struct EinstellungenView: View {
    @Environment(AppModell.self) private var modell
    @AppStorage(Haptik.schalterSchluessel) private var haptik = true

    var body: some View {
        Form {
            Section {
                Toggle("Haptik", isOn: $haptik)
                    .accessibilityIdentifier("schalter-haptik")
            } footer: {
                Text("Kurze Rückmeldung beim Speichern, bei Alarmen und beim Wechsel eines Segments. Nur auf dem iPhone spürbar.")
            }
            Section("Über") {
                LabeledContent("Version", value: modell.appVersion?.fullVersion ?? "unbekannt")
                LabeledContent("Build", value: modell.appVersion?.buildNumber ?? "unbekannt")
            }
        }
        .accessibilityIdentifier("einstellungen")
        .navigationTitle("Einstellungen")
        .navigationBarTitleDisplayMode(.inline)
    }
}
