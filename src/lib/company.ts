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

/** The same company under its newer name, as in the template the owner pasted on 2026-11-26. */
const INDSOL = {
  legalName: "IndSolUSA LLC",
  shortName: "IndSolUSA",
  phone: "+1 (305) 307-0050",
  web: "indsolusa.com",
  billTo: {
    name: "Indsolusa",
    lines: ["11402 NW 41st Street, Suite 211-619", "Doral, FL. 33178 | USA"],
    phone: "+1 (305) 307-0050",
    email: "Sales@indsolusa.com",
  },
  shipTo: {
    name: "Indsolusa",
    lines: ["8435 NW 74TH Street", "Miami, FL, 33166 | USA"],
    phone: "+1 (305) 307-0050",
  },
  supplierPayment: COMPANY.supplierPayment,
} as const;

/** The two names an email can be written as; the person picks one on the email screen. */
export type CompanyKey = "IND" | "INDSOL";
export type CompanyInfo = { legalName: string; shortName: string; phone: string; web: string; billTo: { name: string; lines: readonly string[]; phone: string; email: string }; shipTo: { name: string; lines: readonly string[]; phone: string }; supplierPayment: { EN: string; ES: string } };
export const COMPANIES: Record<CompanyKey, CompanyInfo> = { IND: COMPANY, INDSOL };
export const COMPANY_PICK: Record<CompanyKey, string> = { IND: "Industry Solutions USA", INDSOL: "IndSolUSA" };
export const companyKey = (v: unknown): CompanyKey => (v === "INDSOL" ? "INDSOL" : "IND");

/** Spanish for Latin America and Spain; simple English for everyone else. */
export const spanishCountry = (c: string | null | undefined) =>
  !!c && /colombia|espa|m[eé]xico|per[uú]|chile|argentin|ecuador|panam|venezuel|guatemal|costa rica|hondur|salvador|nicaragu|dominican|bolivi|paraguay|uruguay|cuba/i.test(c);
