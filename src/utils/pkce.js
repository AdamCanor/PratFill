// PKCE crypto primitives — a standard, textbook SHA-256 + base64url, nothing
// bespoke. These are hand-rolled in pure JS on purpose: PKCE needs
// `code_challenge = base64url(sha256(code_verifier))`, React Native/Hermes
// ships no crypto, and the native alternatives (expo-crypto,
// react-native-quick-crypto) would force an `expo prebuild` — which this
// project deliberately avoids by committing android/ (see CLAUDE.md). Keeping
// it pure JS means the whole silent-SSO refresh path in doch1.js stays
// prebuild-free.
//
// Correctness was cross-validated byte-for-byte against Node's own `crypto`
// module before shipping (empty string, "abc", a >64-byte input crossing a
// SHA-256 block boundary, a 1000-char string, and 1/2/3/32-byte base64 edge
// cases — all matched exactly). If you touch this file, re-run that check.
//
// randomBytes draws from a CSPRNG (expo-crypto's native secure RNG) — RFC 7636
// requires the PKCE code_verifier to come from a cryptographically secure
// source, and the same helper also feeds the OAuth `state` and `nonce`. It
// previously used Math.random() (a non-cryptographic Hermes PRNG) to stay
// prebuild-free; that trade-off was dropped in favor of correctness once the
// project took a native module for SecureStore anyway.

import * as Crypto from 'expo-crypto';

function rotr(x, n) {
  return (x >>> n) | (x << (32 - n));
}

export function sha256(data) {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const l = data.length;
  const padLen = (l + 1 + 8 + 63) & ~63;
  const msg = new Uint8Array(padLen);
  msg.set(data);
  msg[l] = 0x80;
  const dv = new DataView(msg.buffer);
  dv.setUint32(padLen - 8, Math.floor((l * 8) / 0x100000000), false);
  dv.setUint32(padLen - 4, (l * 8) >>> 0, false);
  const w = new Uint32Array(64);
  for (let chunk = 0; chunk < padLen; chunk += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(chunk + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const outDv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outDv.setUint32(i * 4, H[i], false);
  return out;
}

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64Encode(bytes) {
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    const triplet = (b0 << 16) | ((b1 || 0) << 8) | (b2 || 0);
    result += B64_CHARS[(triplet >> 18) & 63];
    result += B64_CHARS[(triplet >> 12) & 63];
    result += i + 1 < bytes.length ? B64_CHARS[(triplet >> 6) & 63] : '=';
    result += i + 2 < bytes.length ? B64_CHARS[triplet & 63] : '=';
  }
  return result;
}

export function base64UrlEncode(bytes) {
  return base64Encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomBytes(n) {
  // expo-crypto's getRandomValues fills the array in place from the platform
  // CSPRNG and returns it — synchronous, so callers (trySsoSilent) stay sync.
  return Crypto.getRandomValues(new Uint8Array(n));
}

export function asciiBytes(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}
