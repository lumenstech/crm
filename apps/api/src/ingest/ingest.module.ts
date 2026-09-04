import { Module } from "@nestjs/common";
import { CompaniesModule } from "../companies/companies.module";
import { IngestRouter } from "./ingest.router";
import { IngestService } from "./ingest.service";

@Module({
	imports: [CompaniesModule],
	providers: [IngestService, IngestRouter],
	exports: [IngestService],
})
export class IngestModule {}
