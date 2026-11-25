package dev.rubeen.lifeline.helfer.dienste

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import dev.rubeen.lifeline.kern.AdressException
import dev.rubeen.lifeline.kern.ServerAdresse
import java.io.IOException
import java.security.GeneralSecurityException
import java.security.KeyStore
import java.security.ProviderException
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Server und Sitzungs-Cookie der einen Kopplung. */
data class Sitzung(val server: ServerAdresse, val cookie: String)

/**
 * Ablage der Sitzung (Spec „Server-Verbindung“: unter Android verschlüsselt im Keystore). Das Cookie
 * liegt mit AES/GCM verschlüsselt in den privaten Einstellungen der App; der Schlüssel entsteht im
 * Android Keystore und verlässt ihn nie. Lässt sich die Sitzung nicht lesen (Schlüssel weg, Daten
 * kaputt), gilt sie als gelöscht.
 */
class Sitzungsablage(context: Context) {
    private val einstellungen = context.getSharedPreferences(DATEI, Context.MODE_PRIVATE)

    fun lesen(): Sitzung? {
        val server = einstellungen.getString(SERVER, null) ?: return null
        val iv = einstellungen.getString(IV, null) ?: return null
        val geheim = einstellungen.getString(COOKIE, null) ?: return null
        return try {
            val cipher = Cipher.getInstance(VERFAHREN)
            cipher.init(Cipher.DECRYPT_MODE, schluessel(), GCMParameterSpec(128, Base64.getDecoder().decode(iv)))
            val cookie = String(cipher.doFinal(Base64.getDecoder().decode(geheim)), Charsets.UTF_8)
            Sitzung(ServerAdresse.parse(server), cookie)
        } catch (_: GeneralSecurityException) {
            vergessen()
        } catch (_: IllegalArgumentException) {
            vergessen()
        } catch (_: AdressException) {
            vergessen()
        } catch (_: IOException) {
            vergessen()
        } catch (_: ProviderException) {
            // Der Keystore wirft bei einem ungültig gewordenen Schlüssel auch Laufzeitfehler.
            vergessen()
        }
    }

    fun speichern(sitzung: Sitzung) {
        val cipher = Cipher.getInstance(VERFAHREN)
        cipher.init(Cipher.ENCRYPT_MODE, schluessel())
        val geheim = cipher.doFinal(sitzung.cookie.toByteArray(Charsets.UTF_8))
        einstellungen.edit()
            .putString(SERVER, sitzung.server.text)
            .putString(IV, Base64.getEncoder().encodeToString(cipher.iv))
            .putString(COOKIE, Base64.getEncoder().encodeToString(geheim))
            .apply()
    }

    private fun vergessen(): Sitzung? {
        loeschen()
        return null
    }

    fun loeschen() {
        einstellungen.edit().clear().apply()
    }

    private fun schluessel(): SecretKey {
        val speicher = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (speicher.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val erzeuger = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        erzeuger.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return erzeuger.generateKey()
    }

    private companion object {
        const val DATEI = "helfer-sitzung"
        const val SERVER = "server"
        const val IV = "iv"
        const val COOKIE = "cookie"
        const val KEYSTORE = "AndroidKeyStore"
        const val ALIAS = "helfer-sitzung"
        const val VERFAHREN = "AES/GCM/NoPadding"
    }
}
