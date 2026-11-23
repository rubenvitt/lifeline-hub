package dev.rubeen.lifeline.android

import android.app.Activity
import android.app.AlertDialog
import android.content.DialogInterface
import android.os.Looper
import android.widget.EditText
import androidx.test.core.app.ApplicationProvider
import dev.rubeen.lifeline.android.web.SEITENDIALOG_FELD
import dev.rubeen.lifeline.android.web.zeigeSeitendialog
import dev.rubeen.lifeline.kern.SeitenOrigin
import dev.rubeen.lifeline.kern.Seitendialog
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowAlertDialog

/**
 * `alert`, `confirm` und `prompt` der Seite als nativer Dialog (`HuellenChromeClient`): Titel ist
 * der Host des fragenden Frames, das Ergebnis geht genau einmal zurück.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class SeitendialogAnzeigeTest {
    private val activity: Activity = Robolectric.buildActivity(Activity::class.java).setup().get()
    private val ergebnisse = mutableListOf<Seitendialog.Ergebnis?>()

    private fun zeige(art: Seitendialog.Art, origin: String = "https://idp.example") {
        zeigeSeitendialog(activity, Seitendialog(art, "Wirklich löschen?", SeitenOrigin.parse(origin)!!)) { ergebnisse += it }
    }

    private fun dialog(): AlertDialog = ShadowAlertDialog.getLatestAlertDialog()

    private fun tippe(knopf: Int) {
        dialog().getButton(knopf).performClick()
        shadowOf(Looper.getMainLooper()).idle()
    }

    @Test
    fun `der Titel nennt den fragenden Frame, OK bestätigt`() {
        zeige(Seitendialog.Art.Rueckfrage)

        assertEquals("idp.example", shadowOf(dialog()).title)
        assertEquals("Wirklich löschen?", shadowOf(dialog()).message)
        tippe(DialogInterface.BUTTON_POSITIVE)

        assertEquals(listOf<Seitendialog.Ergebnis?>(Seitendialog.Ergebnis.Ok(null)), ergebnisse)
    }

    @Test
    fun `Abbrechen und Wegtippen brechen ab, genau einmal`() {
        zeige(Seitendialog.Art.Rueckfrage)
        tippe(DialogInterface.BUTTON_NEGATIVE)

        assertEquals(listOf<Seitendialog.Ergebnis?>(Seitendialog.Ergebnis.Abgebrochen), ergebnisse)

        zeige(Seitendialog.Art.Rueckfrage)
        dialog().cancel()
        shadowOf(Looper.getMainLooper()).idle()

        assertEquals(2, ergebnisse.size)
        assertEquals(Seitendialog.Ergebnis.Abgebrochen, ergebnisse[1])
    }

    @Test
    fun `ein Hinweis hat nur OK`() {
        zeige(Seitendialog.Art.Hinweis)

        assertEquals(android.view.View.GONE, dialog().getButton(DialogInterface.BUTTON_NEGATIVE).visibility)
    }

    @Test
    fun `die Eingabe liefert den Text des Feldes mit der Vorgabe der Seite`() {
        zeige(Seitendialog.Art.Eingabe("Lage 1"))
        val feld = shadowOf(dialog()).view.findViewWithTag<EditText>(SEITENDIALOG_FELD)

        assertEquals("Lage 1", feld.text.toString())
        feld.setText("Lage 2")
        tippe(DialogInterface.BUTTON_POSITIVE)

        assertEquals(listOf<Seitendialog.Ergebnis?>(Seitendialog.Ergebnis.Ok("Lage 2")), ergebnisse)
    }

    @Test
    fun `ohne Activity zeigt die Hülle nichts und die Seite lehnt ab`() {
        zeigeSeitendialog(ApplicationProvider.getApplicationContext(), Seitendialog(Seitendialog.Art.Rueckfrage, "?", SeitenOrigin.parse("https://elw.local")!!)) {
            ergebnisse += it
        }

        assertEquals(listOf<Seitendialog.Ergebnis?>(null), ergebnisse)
        assertNull(ShadowAlertDialog.getLatestAlertDialog())
    }
}
