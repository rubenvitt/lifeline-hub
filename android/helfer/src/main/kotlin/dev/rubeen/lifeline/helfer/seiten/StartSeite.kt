package dev.rubeen.lifeline.helfer.seiten

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import dev.rubeen.lifeline.helfer.HelferModell
import dev.rubeen.lifeline.helfer.R
import dev.rubeen.lifeline.helfer.ui.Stil
import dev.rubeen.lifeline.helfer.ui.eckig
import dev.rubeen.lifeline.helfer.ui.farbe

/**
 * Bildschirm 1 „Start“ (Spec „Bildschirme“): QR-Code scannen (Kamera über den ganzen Bildschirm),
 * darunter Code eingeben.
 */
@Composable
fun StartSeite(modell: HelferModell, onScannen: () -> Unit) {
    var eingabe by rememberSaveable { mutableStateOf(false) }
    Seite {
        Seitenkopf()
        Spacer(Modifier.height(Abstand.md))
        Column(verticalArrangement = Arrangement.spacedBy(Abstand.sm)) {
            Augenbraue("Am Einsatz anmelden")
            Text("Scanne den QR-Code der Einsatzleitung.", style = Stil.titel, color = farbe.text)
            Text(
                "Danach siehst du Einsatz und Ziel und meldest dich mit deinem Namen an. Deine Position geht nur an diesen Einsatz und nur, solange du angemeldet bist.",
                style = Stil.text,
                color = farbe.text2,
            )
        }
        Sucherbild()
        modell.meldung?.let { Hinweis(it) }
        Column(verticalArrangement = Arrangement.spacedBy(Abstand.sm)) {
            Hauptknopf(
                "QR-Code scannen",
                onClick = {
                    modell.meldung = null
                    onScannen()
                },
                modifier = Modifier.testTag("scannen"),
                symbol = R.drawable.symbol_qr,
            )
            Nebenknopf(
                "Code eingeben",
                onClick = {
                    modell.meldung = null
                    eingabe = true
                },
                modifier = Modifier.testTag("code-eingeben"),
            )
        }
    }
    if (eingabe) {
        CodeEingabe(modell, fertig = { eingabe = false })
    }
}

/** „Code eingeben“: Server und Code von Hand, falls die Kamera nicht geht. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CodeEingabe(modell: HelferModell, fertig: () -> Unit) {
    var server by rememberSaveable { mutableStateOf("") }
    var code by rememberSaveable { mutableStateOf("") }
    val uebernehmen = { if (modell.eingegeben(server, code)) fertig() }
    ModalBottomSheet(
        onDismissRequest = fertig,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        shape = eckig,
        containerColor = farbe.grund,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = Abstand.rinne)
                .padding(bottom = Abstand.lg)
                .navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(Abstand.md),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(Abstand.sm)) {
                Augenbraue("Code eingeben")
                Text("Server und Code stehen unter dem QR-Code der Einsatzleitung.", style = Stil.text, color = farbe.text2)
            }
            Eingabefeld(
                titel = "Server",
                wert = server,
                onWert = { server = it },
                kennung = "server",
                beispiel = "elw.example.org",
                tastatur = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false, imeAction = ImeAction.Next),
            )
            Eingabefeld(
                titel = "Code",
                wert = code,
                onWert = { code = it },
                kennung = "code",
                beispiel = "AB12CD34",
                mono = true,
                tastatur = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Characters,
                    autoCorrectEnabled = false,
                    keyboardType = KeyboardType.Ascii,
                    imeAction = ImeAction.Go,
                ),
                aktionen = KeyboardActions(onGo = { uebernehmen() }),
            )
            modell.meldung?.let { Hinweis(it) }
            Hauptknopf(
                "Weiter",
                onClick = uebernehmen,
                modifier = Modifier.testTag("weiter"),
                enabled = server.isNotBlank() && code.isNotBlank(),
            )
            Nebenknopf("Abbrechen", onClick = fertig, farbe = farbe.gedaempft)
        }
    }
}
