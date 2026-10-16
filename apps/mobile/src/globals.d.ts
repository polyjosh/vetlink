// Hermes has no Web Crypto; src/lib/polyfills.ts installs randomUUID from expo-crypto, which
// @vetlink/api-client uses for idempotency keys.
// eslint-disable-next-line no-var -- a global declaration has to be `var`
declare var crypto: { randomUUID(): string };
