import { z } from "zod";

export const projectExperienceTags = z.array(z.string().trim().min(1).max(120));

export const opportunityProjectSignals = z
	.array(z.string().trim().min(1).max(120))
	.max(12);

export type ProjectExperienceTags = z.infer<typeof projectExperienceTags>;
export type OpportunityProjectSignals = z.infer<
	typeof opportunityProjectSignals
>;
