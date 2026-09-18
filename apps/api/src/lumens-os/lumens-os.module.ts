import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentVariables } from "../config/env.validation";
import { GAUZY_ADAPTER } from "./lumens-os.constants";
import { CanonicalOpportunityLifecycleService } from "./canonical-opportunity-lifecycle.service";
import { GauzyHttpAdapter } from "./gauzy-http.adapter";
import { GauzyPromotionService } from "./gauzy-promotion.service";
import { LumensOsTaskService } from "./lumens-os-task.service";

@Module({
	providers: [
		{
			provide: GAUZY_ADAPTER,
			inject: [ConfigService],
			useFactory: (config: ConfigService<EnvironmentVariables, true>) => {
				const baseUrl = config.get("GAUZY_API_URL", { infer: true });
				const email = config.get("GAUZY_EMAIL", { infer: true });
				const password = config.get("GAUZY_PASSWORD", { infer: true });
				if (!baseUrl || !email || !password) return null;
				return new GauzyHttpAdapter({
					baseUrl,
					email,
					password,
					tenantId: config.get("GAUZY_TENANT_ID", { infer: true }),
					currency: config.get("GAUZY_CURRENCY", { infer: true }),
				});
			},
		},
		GauzyPromotionService,
		LumensOsTaskService,
		CanonicalOpportunityLifecycleService,
	],
	exports: [GauzyPromotionService, LumensOsTaskService, CanonicalOpportunityLifecycleService],
})
export class LumensOsModule {}
