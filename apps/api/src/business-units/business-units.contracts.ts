import { z } from "zod";

export const businessUnitOutput = z.object({
	id: z.string(),
	key: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	enabled: z.boolean(),
});

export const businessUnitListOutput = z.array(businessUnitOutput);

export const businessUnitRecordType = z.enum(["company", "contact"]);

export const recordBusinessUnitsInput = z.object({
	recordType: businessUnitRecordType,
	recordId: z.string().trim().min(1),
});

export const recordBusinessUnitAssociationOutput = z.object({
	recordType: businessUnitRecordType,
	recordId: z.string(),
	businessUnitId: z.string(),
	businessUnitKey: z.string(),
	businessUnitName: z.string(),
	useCase: z.string().nullable(),
	notes: z.string().nullable(),
	createdAt: z.string(),
});

export const recordBusinessUnitsOutput = z.object({
	recordType: businessUnitRecordType,
	recordId: z.string(),
	associations: z.array(recordBusinessUnitAssociationOutput),
});

export const associateRecordBusinessUnitInput = z.object({
	recordType: businessUnitRecordType,
	recordId: z.string().trim().min(1),
	targetBusinessUnit: z.string().trim().min(1).max(96),
	useCase: z.string().trim().max(1000).nullable().optional(),
	notes: z.string().trim().max(8000).nullable().optional(),
});

export const associateRecordBusinessUnitOutput =
	recordBusinessUnitAssociationOutput.extend({
		created: z.boolean(),
	});

export const createBusinessUnitOpportunityInput = z.object({
	companyId: z.string().trim().min(1),
	contactId: z.string().trim().min(1).nullable().optional(),
	targetBusinessUnit: z.string().trim().min(1).max(96),
	ownerId: z.string().trim().min(1).nullable().optional(),
	name: z.string().trim().min(1).max(320),
	useCase: z.string().trim().max(4000).nullable().optional(),
	notes: z.string().trim().max(8000).nullable().optional(),
});

export const createBusinessUnitOpportunityOutput = z.object({
	opportunityId: z.string(),
	companyId: z.string(),
	canonicalCompanyId: z.string(),
	targetBusinessUnit: z.string(),
	name: z.string(),
	stage: z.string(),
	created: z.boolean(),
});
