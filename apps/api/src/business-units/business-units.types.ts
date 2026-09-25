import type { z } from "zod";
import type {
	associateRecordBusinessUnitInput,
	createBusinessUnitOpportunityInput,
	recordBusinessUnitsInput,
} from "./business-units.contracts";

export type RecordBusinessUnitsInput = z.infer<typeof recordBusinessUnitsInput>;
export type AssociateRecordBusinessUnitInput = z.infer<
	typeof associateRecordBusinessUnitInput
>;
export type CreateBusinessUnitOpportunityInput = z.infer<
	typeof createBusinessUnitOpportunityInput
>;
