import { Inject } from "@nestjs/common";
import { Query, Router, UseMiddlewares } from "nestjs-trpc";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { restMeta } from "../trpc/openapi";
import { businessUnitListOutput } from "./business-units.contracts";
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
}
