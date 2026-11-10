// Operaciones O5a · Carrier Integration Gateway (module 11 §53.2, AC41). Operations talks to carriers only through
// this layer, so its logic never depends on DHL or any one provider. An adapter declares what it can do; anything it
// can't do is done by hand and recorded with its source. Credentials never live here: an adapter reads them from
// the environment through a secret reference (AC51).

export type Capability = "RATE" | "CAPABILITY_CHECK" | "CREATE_SHIPMENT" | "LABELS" | "PICKUP" | "TRACKING" | "PIECE_TRACKING" | "POD" | "DOCUMENTS" | "LANDED_COST";
export type RateRequest = { origin: string; destination: string; shipDate: Date; pieces: { weightKg: number; lengthCm?: number; widthCm?: number; heightCm?: number }[]; declaredValue?: number; currency?: string };
export type RateOption = { service: string; cost: number; currency: string; estimatedDelivery: Date | null; transitDays: number | null; indicative: true; quotedAt: Date; evidence: string };
export type TrackEvent = { code: string; text: string; at: Date; location: string | null; pieceId: string | null; raw: string };

export interface CarrierAdapter {
  key: string;
  label: string;
  capabilities: Capability[];
  /** False when the adapter needs credentials that aren't configured: SOLU then says so instead of failing. */
  configured(): boolean;
  rate?(req: RateRequest): Promise<RateOption[]>;
  track?(trackingNumber: string): Promise<TrackEvent[]>;
}

/** Any carrier or forwarder without an integration: rates, tracking and documents are typed in by a person. */
export const ManualAdapter: CarrierAdapter = { key: "MANUAL", label: "Manual", capabilities: [], configured: () => true };

const registry = new Map<string, CarrierAdapter>([[ManualAdapter.key, ManualAdapter]]);
export const registerAdapter = (a: CarrierAdapter) => { registry.set(a.key, a); };
export const adapterFor = (key: string | null | undefined): CarrierAdapter => registry.get(key ?? "MANUAL") ?? ManualAdapter;
export const adapters = () => [...registry.values()];
export const can = (a: CarrierAdapter, c: Capability) => a.configured() && a.capabilities.includes(c);
