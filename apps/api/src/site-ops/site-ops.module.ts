import { Module } from "@nestjs/common";
import { SiteOpsRouter } from "./site-ops.router";
import { SiteOpsService } from "./site-ops.service";
import { SiteOpsAlertsService } from "./site-ops-alerts.service";
import { SiteOpsCommandService } from "./site-ops-command.service";
import { SiteOpsIngestService } from "./site-ops-ingest.service";

@Module({
	providers: [
		SiteOpsService,
		SiteOpsIngestService,
		SiteOpsAlertsService,
		SiteOpsCommandService,
		SiteOpsRouter,
	],
	exports: [
		SiteOpsService,
		SiteOpsIngestService,
		SiteOpsAlertsService,
		SiteOpsCommandService,
	],
})
export class SiteOpsModule {}
