import { Controller, ForbiddenException, Headers, Param, Post, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import type { EnvironmentVariables } from "../config/env.validation";
import type { GauzyAdapter } from "./gauzy.adapter";
import { GauzyPromotionService } from "./gauzy-promotion.service";
import { GAUZY_ADAPTER } from "./lumens-os.constants";
import { Inject } from "@nestjs/common";

@Controller("internal/lumens-os")
export class LumensOsController {
	private readonly secret: string | undefined;
	constructor(
		private readonly promotions: GauzyPromotionService,
		@Inject(GAUZY_ADAPTER) private readonly gauzy: GauzyAdapter | null,
		config: ConfigService<EnvironmentVariables, true>,
	) {
		this.secret = config.get("CRON_SECRET", { infer: true });
	}

	@Post("gauzy/promote/:eventId")
	@AllowAnonymous()
	async promote(@Param("eventId") eventId: string, @Headers("authorization") authorization?: string) {
		if (!this.secret) throw new ServiceUnavailableException("Internal task execution is not configured.");
		if (!timingSafeEquals(authorization ?? "", `Bearer ${this.secret}`)) throw new ForbiddenException();
		if (!this.gauzy) throw new ServiceUnavailableException("Gauzy is not configured.");
		return this.promotions.promote(eventId, this.gauzy);
	}
}

function timingSafeEquals(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let mismatch = 0;
	for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return mismatch === 0;
}
