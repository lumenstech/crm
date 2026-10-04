import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AuthHooksService } from "./auth-hooks.service";
import { OAuthMetadataController } from "./oauth-metadata.controller";

@Module({
	controllers: [AuthController, OAuthMetadataController],
	providers: [AuthService, AuthHooksService],
	exports: [AuthService],
})
export class AuthModule {}
