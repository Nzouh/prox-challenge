import { z } from "zod";

/** The four processes the OmniPro 220 supports. */
export const weldProcessSchema = z.enum(["MIG", "flux_cored", "TIG", "stick"]);
export type WeldProcess = z.infer<typeof weldProcessSchema>;

/** The machine takes either supply voltage; nearly every spec forks on it. */
export const inputVoltageSchema = z.union([z.literal(120), z.literal(240)]);
export type InputVoltage = z.infer<typeof inputVoltageSchema>;
