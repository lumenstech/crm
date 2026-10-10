import { Module } from "@nestjs/common";
import { TrpcModule } from "../trpc/trpc.module";
import { ExecutorController } from "./executor.controller";
import { ExecutorRouter } from "./executor.router";
import { ExecutorService } from "./executor.service";

@Module({
	imports: [TrpcModule],
	controllers: [ExecutorController],
	providers: [ExecutorService, ExecutorRouter],
})
export class ExecutorModule {}
