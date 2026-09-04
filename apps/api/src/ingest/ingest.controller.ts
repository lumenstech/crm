import {
	Body,
	Controller,
	Headers,
	Post,
	ServiceUnavailableException,
	UnauthorizedException,
} from "@nestjs/common";
import type { IngestSignalRequest } from "./ingest.contracts";
import { IngestService } from "./ingest.service";

@Controller("ingest")
export class IngestController {
	constructor(private readonly ingestService: IngestService) {}

	@Post("signal")
	async ingestSignal(
		@Headers("x-ingest-key") key: string | undefined,
		@Body() body: IngestSignalRequest,
	) {
		const expected = process.env.CRM_INGEST_API_KEY;
		if (!expected) {
			throw new ServiceUnavailableException("CRM ingestion is not configured");
		}
		if (!key || key !== expected) {
			throw new UnauthorizedException();
		}
		return this.ingestService.ingestSignal(body);
	}
}
