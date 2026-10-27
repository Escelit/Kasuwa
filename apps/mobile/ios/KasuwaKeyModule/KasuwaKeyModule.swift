/**
 * KasuwaKeyModule.swift — iOS Secure Enclave P-256 signing module.
 *
 * Key facts about Secure Enclave signing:
 * - Algorithm: kSecKeyAlgorithmECDSASignatureDigestX962SHA256
 *   "The data to be signed is the digest of the message, not the message itself."
 *   (Apple docs, SecKeyCreateSignature). The API signs the raw 32-byte digest
 *   WITHOUT re-hashing. This is what we want: sign(digest) = ECDSA(digest).
 * - Output: ASN.1 DER-encoded ECDSA signature. Must be converted to raw r||s
 *   and low-S normalized in the JS layer (packages/protocol).
 * - Keys are non-exportable and bound to the Secure Enclave.
 * - Access control: biometricAny or devicePasscode (configurable).
 *
 * Key invalidation:
 *   iOS invalidates Secure Enclave keys when biometric enrollment changes
 *   (new fingerprint / Face ID reset). In that case SecKeyCreateSignature
 *   returns errSecAuthFailed. We surface this as KEY_INVALIDATED.
 *   Recovery: customer must create a new allowance; old one is reclaimable.
 */

import Foundation
import Security
import LocalAuthentication
import React

@objc(KasuwaKeyModule)
class KasuwaKeyModule: NSObject {

  // MARK: - React Native module metadata

  @objc
  static func requiresMainQueueSetup() -> Bool { false }

  // MARK: - generate

  @objc
  func generate(
    _ alias: String,
    requireBiometric: Bool,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let tag = keyTag(alias)

    // Return existing key if present
    if let existingKey = loadPublicKey(tag: tag) {
      guard let pubKeyData = exportUncompressedPublicKey(existingKey) else {
        reject("PLATFORM_ERROR", "Failed to export existing public key", nil)
        return
      }
      resolve(["publicKey": [UInt8](pubKeyData)])
      return
    }

    // Build access control flags
    var flags: SecAccessControlCreateFlags = [.privateKeyUsage]
    if requireBiometric {
      flags.insert(.biometricAny)
    }
    guard let access = SecAccessControlCreateWithFlags(
      kCFAllocatorDefault,
      kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
      flags,
      nil
    ) else {
      reject("PLATFORM_ERROR", "Failed to create access control", nil)
      return
    }

    let attributes: [String: Any] = [
      kSecAttrKeyType as String:            kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeySizeInBits as String:      256,
      kSecAttrTokenID as String:            kSecAttrTokenIDSecureEnclave,
      kSecPrivateKeyAttrs as String: [
        kSecAttrIsPermanent as String:      true,
        kSecAttrApplicationTag as String:   tag,
        kSecAttrAccessControl as String:    access,
      ] as [String: Any],
    ]

    var error: Unmanaged<CFError>?
    guard let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
      let msg = error.map { String(describing: $0.takeRetainedValue()) } ?? "Unknown error"
      reject("PLATFORM_ERROR", "SecKeyCreateRandomKey failed: \(msg)", nil)
      return
    }

    guard let publicKey = SecKeyCopyPublicKey(privateKey),
          let pubKeyData = exportUncompressedPublicKey(publicKey) else {
      reject("PLATFORM_ERROR", "Failed to export new public key", nil)
      return
    }

    resolve(["publicKey": [UInt8](pubKeyData)])
  }

  // MARK: - sign

  @objc
  func sign(
    _ alias: String,
    digest digestArray: [Any],
    prompt: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let digestBytes = digestArray as? [UInt8], digestBytes.count == 32 else {
      reject("INVALID_DIGEST", "digest must be exactly 32 bytes", nil)
      return
    }

    let tag = keyTag(alias)
    guard let privateKey = loadPrivateKey(tag: tag) else {
      reject("KEY_NOT_FOUND", "No key found for alias '\(alias)'", nil)
      return
    }

    let context = LAContext()
    context.localizedReason = prompt

    let digestData = Data(digestBytes)
    var error: Unmanaged<CFError>?
    // kSecKeyAlgorithmECDSASignatureDigestX962SHA256:
    //   Signs the *digest* directly — no additional hashing.
    guard let sigData = SecKeyCreateSignature(
      privateKey,
      .ecdsaSignatureDigestX962SHA256,
      digestData as CFData,
      &error
    ) as Data? else {
      let msg = error.map { String(describing: $0.takeRetainedValue()) } ?? "Unknown"
      // Distinguish invalidated key from auth failure
      let errStr = msg.lowercased()
      if errStr.contains("invalidated") || errStr.contains("-25293") {
        reject("KEY_INVALIDATED", "Key invalidated: biometric enrollment changed. Create a new allowance.", nil)
      } else if errStr.contains("auth") || errStr.contains("-25293") {
        reject("AUTH_FAILED", "Biometric authentication failed or cancelled", nil)
      } else {
        reject("PLATFORM_ERROR", "SecKeyCreateSignature failed: \(msg)", nil)
      }
      return
    }

    // Return raw DER bytes; JS layer converts to r||s + low-S
    resolve([UInt8](sigData))
  }

  // MARK: - exists

  @objc
  func exists(
    _ alias: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(loadPublicKey(tag: keyTag(alias)) != nil)
  }

  // MARK: - delete

  @objc
  func delete(
    _ alias: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let query: [String: Any] = [
      kSecClass as String:                kSecClassKey,
      kSecAttrApplicationTag as String:   keyTag(alias),
    ]
    SecItemDelete(query as CFDictionary)
    resolve(nil)
  }

  // MARK: - Helpers

  private func keyTag(_ alias: String) -> Data {
    "com.kasuwa.key.\(alias)".data(using: .utf8)!
  }

  private func loadPrivateKey(tag: Data) -> SecKey? {
    let query: [String: Any] = [
      kSecClass as String:                kSecClassKey,
      kSecAttrKeyType as String:          kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrApplicationTag as String:   tag,
      kSecReturnRef as String:            true,
    ]
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess else { return nil }
    return (item as! SecKey)
  }

  private func loadPublicKey(tag: Data) -> SecKey? {
    guard let priv = loadPrivateKey(tag: tag) else { return nil }
    return SecKeyCopyPublicKey(priv)
  }

  /// Exports an EC public key as 65-byte uncompressed point (0x04 || X || Y).
  private func exportUncompressedPublicKey(_ key: SecKey) -> Data? {
    var error: Unmanaged<CFError>?
    guard let data = SecKeyCopyExternalRepresentation(key, &error) as Data? else {
      return nil
    }
    // Secure Enclave exports as 64-byte raw X||Y; we prefix with 0x04
    if data.count == 64 {
      var uncompressed = Data([0x04])
      uncompressed.append(data)
      return uncompressed
    }
    // Some devices return 65-byte form already
    if data.count == 65 && data[0] == 0x04 {
      return data
    }
    return nil
  }
}
