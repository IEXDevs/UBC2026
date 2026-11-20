/**
 * HPKE recipient for a Privy wallet export.
 * The private key is created in this browser and used only to open the download.
 */
import { CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from '@hpke/core';
import { Chacha20Poly1305 } from '@hpke/chacha20poly1305';

function suite() {
  return new CipherSuite({
    kem: new DhkemP256HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Chacha20Poly1305(),
  });
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function createExportRecipient() {
  const hpke = suite();
  const pair = await hpke.kem.generateKeyPair();
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  return {
    publicKey: bytesToBase64(spki),
    async open(encapsulatedKey, ciphertext) {
      const context = await hpke.createRecipientContext({
        recipientKey: pair.privateKey,
        enc: base64ToBytes(encapsulatedKey),
      });
      return new TextDecoder().decode(await context.open(base64ToBytes(ciphertext)));
    },
  };
}

/** Test helper: seal to a recipient public key with the same suite Privy uses. */
export async function sealForRecipient(publicKey, text) {
  const hpke = suite();
  const key = await crypto.subtle.importKey('spki', base64ToBytes(publicKey),
    { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  const sealed = await hpke.seal({ recipientPublicKey: key }, new TextEncoder().encode(text));
  return {
    encapsulatedKey: bytesToBase64(new Uint8Array(sealed.enc)),
    ciphertext: bytesToBase64(new Uint8Array(sealed.ct)),
  };
}
