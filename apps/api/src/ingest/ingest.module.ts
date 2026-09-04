import { Module } from "@nestjs/common";
import { IngestRouter } from "./ingest.router";
import { IngestService } from "./ingest.service";

@Module({
	providers: [IngestService, IngestRouter],
	exports: [IngestService],
})
export class IngestModule {}
