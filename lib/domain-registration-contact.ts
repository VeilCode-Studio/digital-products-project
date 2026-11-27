import { z } from "zod";
import { DOMAIN_COUNTRIES } from "./domain-registration-terms";

const text = (max: number) => z.string().trim().min(1).max(max).refine((s) => !/[\x00-\x1f\x7f]/.test(s));
export const registrationContactSchema = z.object({
  firstName: text(100), lastName: text(100), email: z.email().max(254),
  phone: z.string().regex(/^\+[1-9][0-9]{6,14}$/), address1: text(200),
  address2: z.string().trim().max(200).default(""), city: text(100), state: text(100),
  zip: text(30), country: z.string().refine((s) => DOMAIN_COUNTRIES.includes(s)), companyName: z.string().trim().max(100).default(""),
}).strict();
export type RegistrationContact = z.infer<typeof registrationContactSchema>;
