// Company details used in outgoing emails, taken from the company's own RFQ template (shared by the
// user on 2026-11-06). Public business addresses only. Bank details are NEVER here: they come only
// from the verified company bank profile (not built yet), so no email includes them.
export const COMPANY = {
  legalName: "INDUSTRY SOLUTIONS USA LLC",
  shortName: "Industry Solutions USA",
  phone: "+1 (305) 307-0050",
  web: "industrysolutionsusa.com",
  billTo: {
    name: "INDUSTRY SOLUTIONS USA LLC",
    lines: ["11402 NW 41st Street, Suite 211-619", "Doral, FL. 33178 | USA"],
    phone: "+1 (305) 307-0050",
    email: "purchases@industrysolutionsusa.com",
  },
  shipTo: {
    name: "INDUSTRY SOLUTIONS USA",
    lines: ["8435 NW 74TH Street", "Miami, FL, 33166 | USA"],
    phone: "+1 (305) 307-0050",
  },
  /** Supplier payment policy stated in every RFQ. */
  supplierPayment: { EN: "Pay in Advance", ES: "pago anticipado" },
} as const;

/** Spanish for Latin America and Spain; simple English for everyone else. */
export const spanishCountry = (c: string | null | undefined) =>
  !!c && /colombia|espa|m[eé]xico|per[uú]|chile|argentin|ecuador|panam|venezuel|guatemal|costa rica|hondur|salvador|nicaragu|dominican|bolivi|paraguay|uruguay|cuba/i.test(c);
