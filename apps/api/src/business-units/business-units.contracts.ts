import { z } from "zod";

export const businessUnitOutput = z.object({
	id: z.string(),
	key: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	enabled: z.boolean(),
});

export const businessUnitListOutput = z.array(businessUnitOutput);
