import { registerAdapter, type CarrierAdapter } from "./gateway";

// Operaciones O5b · DHL Express adapter (MyDHL API) — FRAME ONLY as of 2026-11-10.
//
// What is here: where the credentials come from, how SOLU knows whether an account is configured, and the place the
// calls will live. What is deliberately NOT here: the calls themselves (rates, create shipment, labels, pickup,
// tracking, proof of delivery, documents, landed cost). They must be written from DHL's official MyDHL API
// specification, which could not be read from this environment (the developer portal rejected automated access).
// Field names are not guessed: a wrong "create shipment" would make a wrong real shipment.
//
// Credentials (AC51) live only in the server environment, never in the database, the code, logs or the screen.
// For an account whose secret reference is DHL_USA, the variables are:
//   DHL_USA_API_KEY      the API key / username DHL issued
//   DHL_USA_API_SECRET   the API secret / password DHL issued
//   DHL_USA_ACCOUNT      the DHL Express account number

export const DHL_KEY = "DHL_EXPRESS";
export const SECRET_REF = /^[A-Z][A-Z0-9_]{2,30}$/;
export const dhlEnvNames = (secretRef: string) => ({ key: `${secretRef}_API_KEY`, secret: `${secretRef}_API_SECRET`, account: `${secretRef}_ACCOUNT` });

/** Which of the three values are present for this secret reference. Returns presence only, never a value. */
export function dhlCredentialStatus(secretRef: string) {
  const n = dhlEnvNames(secretRef);
  const has = (k: string) => !!process.env[k]?.trim();
  const state = { key: has(n.key), secret: has(n.secret), account: has(n.account) };
  return { ...state, complete: state.key && state.secret && state.account, names: n };
}

export const DhlExpressAdapter: CarrierAdapter = {
  key: DHL_KEY,
  label: "DHL Express (MyDHL API)",
  // Empty until each call is written from the official specification and verified in DHL's test environment.
  capabilities: [],
  configured: () => false,
};
registerAdapter(DhlExpressAdapter);
