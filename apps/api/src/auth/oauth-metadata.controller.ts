import { auth } from "@crm/auth";
import { Controller, Get, Header } from "@nestjs/common";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";

@Controller()
export class OAuthMetadataController {
	@Get([
		".well-known/oauth-authorization-server",
		".well-known/oauth-authorization-server/api/auth",
	])
	@AllowAnonymous()
	@Header("cache-control", "public, max-age=15, stale-while-revalidate=15")
	async metadata() {
		return auth.api.getOAuthServerConfig();
	}
}
