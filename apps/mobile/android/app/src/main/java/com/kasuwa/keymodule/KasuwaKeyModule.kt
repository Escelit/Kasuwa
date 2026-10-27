package com.kasuwa.keymodule

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.KeyPermanentlyInvalidatedException
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.facebook.react.bridge.*
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECPoint

/**
 * KasuwaKeyModule.kt — Android Keystore (StrongBox / TEE) P-256 signing module.
 *
 * Key facts about Android Keystore signing:
 * - We use "NONEwithECDSA" (not "SHA256withECDSA") so that the Keystore
 *   signs the raw bytes passed in WITHOUT re-hashing. This is critical:
 *   sign() receives a precomputed 32-byte SHA-256 digest and must sign it
 *   as-is, consistent with the iOS path and the on-chain verifier.
 * - StrongBox is preferred; falls back to TEE if unavailable.
 * - Output: ASN.1 DER-encoded ECDSA signature. JS layer converts to r||s + low-S.
 * - Keys are non-extractable (KeyProperties.PURPOSE_SIGN only, no PURPOSE_WRAP_KEY).
 *
 * Key invalidation:
 *   Android invalidates keys when new biometric credentials are enrolled.
 *   This throws KeyPermanentlyInvalidatedException. We surface it as KEY_INVALIDATED.
 *   Recovery: customer must create a new allowance; old one is reclaimable.
 */
class KasuwaKeyModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val KEY_PREFIX = "com.kasuwa.key."
    }

    override fun getName(): String = "KasuwaKeyModule"

    // -------------------------------------------------------------------------
    // generate
    // -------------------------------------------------------------------------

    @ReactMethod
    fun generate(alias: String, requireBiometric: Boolean, promise: Promise) {
        val keyAlias = KEY_PREFIX + alias
        try {
            val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).also { it.load(null) }

            // Return existing key if already generated
            if (keyStore.containsAlias(keyAlias)) {
                val existing = keyStore.getCertificate(keyAlias).publicKey
                promise.resolve(buildPublicKeyResult(existing as java.security.PublicKey))
                return
            }

            val purposes = KeyProperties.PURPOSE_SIGN

            val specBuilder = KeyGenParameterSpec.Builder(keyAlias, purposes)
                .setAlgorithmParameterSpec(java.security.spec.ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_NONE) // NONEwithECDSA — no re-hash
                .setUserAuthenticationRequired(requireBiometric)

            if (requireBiometric) {
                // Require biometric for every use (no time window)
                specBuilder.setUserAuthenticationParameters(0,
                    KeyProperties.AUTH_BIOMETRIC_STRONG)
                // Invalidate key on new biometric enrollment
                specBuilder.setInvalidatedByBiometricEnrollment(true)
            }

            // Try StrongBox first, fall back to TEE
            var spec: KeyGenParameterSpec? = null
            try {
                spec = specBuilder.setIsStrongBoxBacked(true).build()
            } catch (_: Exception) { /* StrongBox unavailable */ }

            if (spec == null) {
                spec = specBuilder.setIsStrongBoxBacked(false).build()
            }

            val kpg = KeyPairGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_EC, ANDROID_KEYSTORE
            )
            kpg.initialize(spec!!)
            val keyPair = kpg.generateKeyPair()
            promise.resolve(buildPublicKeyResult(keyPair.public))

        } catch (e: Exception) {
            promise.reject("PLATFORM_ERROR", "generate failed: ${e.message}", e)
        }
    }

    // -------------------------------------------------------------------------
    // sign
    // -------------------------------------------------------------------------

    @ReactMethod
    fun sign(alias: String, digest: ReadableArray, prompt: String, promise: Promise) {
        val digestBytes = ByteArray(digest.size()) { digest.getInt(it).toByte() }
        if (digestBytes.size != 32) {
            promise.reject("INVALID_DIGEST", "digest must be exactly 32 bytes, got ${digestBytes.size}")
            return
        }

        val keyAlias = KEY_PREFIX + alias
        val activity = currentActivity as? FragmentActivity
            ?: run {
                promise.reject("PLATFORM_ERROR", "No FragmentActivity available for biometric prompt")
                return
            }

        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).also { it.load(null) }
        if (!keyStore.containsAlias(keyAlias)) {
            promise.reject("KEY_NOT_FOUND", "No key found for alias '$alias'")
            return
        }

        try {
            val privateKey = keyStore.getKey(keyAlias, null) as java.security.PrivateKey
            // NONEwithECDSA: signs the raw bytes, no re-hash
            val signature = Signature.getInstance("NONEwithECDSA")
            signature.initSign(privateKey)

            val promptInfo = BiometricPrompt.PromptInfo.Builder()
                .setTitle("Authorize payment")
                .setSubtitle(prompt)
                .setNegativeButtonText("Cancel")
                .setAllowedAuthenticators(
                    androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
                )
                .build()

            val executor = ContextCompat.getMainExecutor(reactApplicationContext)
            val cryptoObject = BiometricPrompt.CryptoObject(signature)

            val biometricPrompt = BiometricPrompt(
                activity,
                executor,
                object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(
                        result: BiometricPrompt.AuthenticationResult
                    ) {
                        try {
                            val sig = result.cryptoObject?.signature
                                ?: run {
                                    promise.reject("PLATFORM_ERROR", "No crypto object after auth")
                                    return
                                }
                            sig.update(digestBytes)
                            // DER-encoded signature; JS layer converts to r||s + low-S
                            val derSig = sig.sign()
                            val array = WritableNativeArray()
                            derSig.forEach { array.pushInt(it.toInt() and 0xFF) }
                            promise.resolve(array)
                        } catch (e: KeyPermanentlyInvalidatedException) {
                            promise.reject("KEY_INVALIDATED",
                                "Key invalidated: biometric enrollment changed. Create a new allowance.", e)
                        } catch (e: Exception) {
                            promise.reject("PLATFORM_ERROR", "Sign failed: ${e.message}", e)
                        }
                    }

                    override fun onAuthenticationError(errCode: Int, errString: CharSequence) {
                        promise.reject("AUTH_FAILED",
                            "Biometric authentication failed ($errCode): $errString")
                    }

                    override fun onAuthenticationFailed() {
                        // Called for each failed attempt; don't reject yet (user gets retries)
                    }
                }
            )

            activity.runOnUiThread {
                biometricPrompt.authenticate(promptInfo, cryptoObject)
            }
        } catch (e: KeyPermanentlyInvalidatedException) {
            promise.reject("KEY_INVALIDATED",
                "Key invalidated: biometric enrollment changed. Create a new allowance.", e)
        } catch (e: Exception) {
            promise.reject("PLATFORM_ERROR", "sign setup failed: ${e.message}", e)
        }
    }

    // -------------------------------------------------------------------------
    // exists
    // -------------------------------------------------------------------------

    @ReactMethod
    fun exists(alias: String, promise: Promise) {
        try {
            val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).also { it.load(null) }
            promise.resolve(keyStore.containsAlias(KEY_PREFIX + alias))
        } catch (e: Exception) {
            promise.reject("PLATFORM_ERROR", "exists failed: ${e.message}", e)
        }
    }

    // -------------------------------------------------------------------------
    // delete
    // -------------------------------------------------------------------------

    @ReactMethod
    fun delete(alias: String, promise: Promise) {
        try {
            val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).also { it.load(null) }
            keyStore.deleteEntry(KEY_PREFIX + alias)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("PLATFORM_ERROR", "delete failed: ${e.message}", e)
        }
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /**
     * Converts an EC public key to a WritableMap with a 65-byte uncompressed
     * point as a JS number array.
     */
    private fun buildPublicKeyResult(publicKey: java.security.PublicKey): WritableMap {
        val ecPub = publicKey as ECPublicKey
        val uncompressed = encodeUncompressed(ecPub.w)
        val array = WritableNativeArray()
        uncompressed.forEach { array.pushInt(it.toInt() and 0xFF) }
        return WritableNativeMap().also { it.putArray("publicKey", array) }
    }

    /** Encodes an EC point as 0x04 || X(32) || Y(32). */
    private fun encodeUncompressed(point: ECPoint): ByteArray {
        val x = point.affineX.toByteArray().let { padOrTrim(it, 32) }
        val y = point.affineY.toByteArray().let { padOrTrim(it, 32) }
        return byteArrayOf(0x04) + x + y
    }

    /** Pads (left with zeros) or trims (leading zero from BigInteger) to exactly `len` bytes. */
    private fun padOrTrim(bytes: ByteArray, len: Int): ByteArray = when {
        bytes.size == len -> bytes
        bytes.size > len  -> bytes.copyOfRange(bytes.size - len, bytes.size) // trim leading 0x00
        else              -> ByteArray(len - bytes.size) + bytes             // left-pad with zeros
    }
}
