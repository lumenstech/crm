import { Inject } from "@nestjs/common";
import { Input, Mutation, Query, Router, UseMiddlewares } from "nestjs-trpc";
import type { z } from "zod";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { restMeta } from "../trpc/openapi";
import {
	associateRecordBusinessUnitInput,
	associateRecordBusinessUnitOutput,
	businessUnitListOutput,
	createBusinessUnitOpportunityInput,
	createBusinessUnitOpportunityOutput,
	recordBusinessUnitsInput,
	recordBusinessUnitsOutput,
} from "./business-units.contracts";
import { BusinessUnitsService } from "./business-units.service";

@Router({ alias: "businessUnits" })
@UseMiddlewares(AuthMiddleware)
export class BusinessUnitsRouter {
	constructor(
		@Inject(BusinessUnitsService)
		private readonly businessUnits: BusinessUnitsService,
	) {}

	@Query({
		output: businessUnitListOutput,
		meta: restMeta("GET", "/business-units", ["Business Units"]),
	})
	async list() {
		return this.businessUnits.list();
	}

	@Query({
		input: recordBusinessUnitsInput,
		output: recordBusinessUnitsOutput,
		meta: restMeta("GET", "/business-units/associations", ["Business Units"]),
	})
	async associations(@Input() input: z.infer<typeof recordBusinessUnitsInput>) {
		return this.businessUnits.recordAssociations(input);
	}

	@Mutation({
		input: associateRecordBusinessUnitInput,
		output: associateRecordBusinessUnitOutput,
		meta: restMeta("POST", "/business-units/associations", ["Business Units"]),
	})
	async associate(
		@Input() input: z.infer<typeof associateRecordBusinessUnitInput>,
	) {
		return this.businessUnits.associate(input);
	}

	@Mutation({
		input: createBusinessUnitOpportunityInput,
		output: createBusinessUnitOpportunityOutput,
		meta: restMeta("POST", "/business-units/opportunities", ["Business Units"]),
	})
	async createOpportunity(
		@Input() input: z.infer<typeof createBusinessUnitOpportunityInput>,
	) {
		return this.businessUnits.createOpportunity(input);
	}
}
