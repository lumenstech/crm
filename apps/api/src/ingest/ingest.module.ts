import { Module } from "@nestjs/common";
import { CompaniesModule } from "../companies/companies.module";
import { IngestRouter } from "./ingest.router";
import { IngestService } from "./ingest.service";
import { PromotionService } from "./promotion.service";
import { ResolutionRouter } from "./resolution.router";
import { ResolutionService } from "./resolution.service";

@Module({
	imports: [CompaniesModule],
	providers: [IngestService, IngestRouter, PromotionService, ResolutionService, ResolutionRouter],
	exports: [IngestService],
})
export class IngestModule {}
