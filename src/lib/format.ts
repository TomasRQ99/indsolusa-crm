import type { DealStage } from "@prisma/client";

export const STAGES: DealStage[] = ["LEAD", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"];

export const STAGE_LABEL: Record<DealStage, string> = {
  LEAD: "Lead",
  QUALIFIED: "Qualified",
  PROPOSAL: "Proposal",
  NEGOTIATION: "Negotiation",
  WON: "Won",
  LOST: "Lost",
};

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

export function formatMoney(value: unknown) {
  return money.format(Number(value ?? 0));
}

export function formatDate(value: Date | null | undefined) {
  return value ? date.format(value) : "—";
}

export function toDateInput(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : "";
}
