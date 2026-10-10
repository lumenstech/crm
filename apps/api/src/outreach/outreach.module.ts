import { Module } from "@nestjs/common";
import { TrpcModule } from "../trpc/trpc.module";
import { OutreachRouter } from "./outreach.router";
import { OutreachService } from "./outreach.service";

@Module({
	imports: [TrpcModule],
	providers: [OutreachService, OutreachRouter],
	exports: [OutreachService],
})
export class OutreachModule {}
