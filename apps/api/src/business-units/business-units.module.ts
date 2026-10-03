import { Module } from "@nestjs/common";
import { BusinessUnitsRouter } from "./business-units.router";
import { BusinessUnitsService } from "./business-units.service";

@Module({
	providers: [BusinessUnitsService, BusinessUnitsRouter],
	exports: [BusinessUnitsService],
})
export class BusinessUnitsModule {}
