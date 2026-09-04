import { Inject } from "@nestjs/common";
import { Input, Mutation, Query, Router, UseMiddlewares } from "nestjs-trpc";
import type { z } from "zod";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { restMeta } from "../trpc/openapi";
import {
	ingestSignalInput,
	ingestSignalOutput,
	resolveSignalCompanyInput,
	resolveSignalCompanyOutput,
	signalCompanyCandidatesOutput,
	signalInboxInput,
	signalInboxOutput,
	signalSourceRecordInput,
} from "./ingest.contracts";
import { IngestService } from "./ingest.service";

@Router({ alias: "ingest" })
@UseMiddlewares(AuthMiddleware)
export class IngestRouter {
	constructor(@Inject(IngestService) private readonly ingest: IngestService) {}

	@Mutation({
		input: ingestSignalInput,
		output: ingestSignalOutput,
		meta: restMeta("POST", "/ingest/signal", ["Ingest"]),
	})
	async signal(@Input() input: z.infer<typeof ingestSignalInput>) {
		return this.ingest.signal(input);
	}

	@Query({
		input: signalInboxInput,
		output: signalInboxOutput,
		meta: restMeta("GET", "/ingest/signals", ["Ingest"]),
	})
	async inbox(@Input() input: z.infer<typeof signalInboxInput>) {
		return this.ingest.inbox(input);
	}

	@Query({
		input: signalSourceRecordInput,
		output: signalCompanyCandidatesOutput,
		meta: restMeta("GET", "/ingest/signals/{sourceRecordId}/company-candidates", [
			"Ingest",
		]),
	})
	async companyCandidates(@Input("sourceRecordId") sourceRecordId: string) {
		return this.ingest.companyCandidates(sourceRecordId);
	}

	@Mutation({
		input: resolveSignalCompanyInput,
		output: resolveSignalCompanyOutput,
		meta: restMeta("POST", "/ingest/signals/{sourceRecordId}/resolve-company", [
			"Ingest",
		]),
	})
	async resolveCompany(@Input() input: z.infer<typeof resolveSignalCompanyInput>) {
		return this.ingest.resolveCompany(input);
	}
}
