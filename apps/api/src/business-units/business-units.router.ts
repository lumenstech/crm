import { Inject } from "@nestjs/common";
import { Input, Mutation, Query, Router, UseMiddlewares } from "nestjs-trpc";
import type { z } from "zod";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { restMeta } from "../trpc/openapi";
import {
	associateRecordInput,
	businessUnitListOutput,
	createBusinessUnitOpportunityInput,
	createBusinessUnitOpportunityOutput,
	recordAssociationOutput,
	recordAssociationsInput,
	recordAssociationsOutput,
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

	@Mutation({
		input: associateRecordInput,
		output: recordAssociationOutput,
		meta: restMeta("POST", "/business-units/associations", ["Business Units"]),
	})
	async associateRecord(@Input() input: z.infer<typeof associateRecordInput>) {
		return this.businessUnits.associateRecord(input);
	}

	@Query({
		input: recordAssociationsInput,
		output: recordAssociationsOutput,
		meta: restMeta("GET", "/business-units/associations", ["Business Units"]),
	})
	async recordAssociations(
		@Input() input: z.infer<typeof recordAssociationsInput>,
	) {
		return this.businessUnits.recordAssociations(
			input.recordType,
			input.recordId,
		);
	}

	@Mutation({
		input: createBusinessUnitOpportunityInput,
		output: createBusinessUnitOpportunityOutput,
		meta: restMeta("POST", "/business-units/opportunities", ["Business Units"]),
	})
	async createBusinessUnitOpportunity(
		@Input() input: z.infer<typeof createBusinessUnitOpportunityInput>,
	) {
		return this.businessUnits.createBusinessUnitOpportunity(input);
	}
}
