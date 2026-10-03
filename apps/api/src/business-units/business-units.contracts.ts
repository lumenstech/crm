import { z } from "zod";

export const businessUnitOutput = z.object({
	id: z.string(),
	key: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	enabled: z.boolean(),
});

export const businessUnitListOutput = z.array(businessUnitOutput);

export const reusableRecordType = z.enum(["company", "contact"]);

export const associateRecordInput = z.object({
	recordType: reusableRecordType,
	recordId: z.string().trim().min(1),
	targetBusinessUnit: z.string().trim().min(1).max(96),
	useCase: z.string().trim().min(1).max(240).nullable().optional(),
	notes: z.string().trim().max(2000).nullable().optional(),
});

export const recordAssociationOutput = z.object({
	id: z.string(),
	recordType: reusableRecordType,
	recordId: z.string(),
	sourceBusinessUnit: z
		.object({ id: z.string(), key: z.string(), name: z.string() })
		.nullable(),
	targetBusinessUnit: z.object({
		id: z.string(),
		key: z.string(),
		name: z.string(),
	}),
	useCase: z.string().nullable(),
	notes: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export const recordAssociationsInput = z.object({
	recordType: reusableRecordType,
	recordId: z.string().trim().min(1),
});

export const recordAssociationsOutput = z.array(recordAssociationOutput);

export const createBusinessUnitOpportunityInput = z.object({
	companyId: z.string().trim().min(1),
	contactId: z.string().trim().min(1).nullable().optional(),
	targetBusinessUnit: z.string().trim().min(1).max(96),
	ownerId: z.string().trim().min(1).nullable().optional(),
	name: z.string().trim().min(1).max(240),
	useCase: z.string().trim().min(1).max(240).nullable().optional(),
	notes: z.string().trim().max(4000).nullable().optional(),
});

export const createBusinessUnitOpportunityOutput = z.object({
	dealId: z.string(),
	companyId: z.string(),
	contactId: z.string().nullable(),
	businessUnit: z.object({
		id: z.string(),
		key: z.string(),
		name: z.string(),
	}),
	associationId: z.string(),
	created: z.boolean(),
});
