import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { BusinessUnitsModule } from "../business-units/business-units.module";
import { CompaniesModule } from "../companies/companies.module";
import { EmailIngestModule } from "../email-ingest/email-ingest.module";
import { HistoricalEmailImportService } from "./history-import.service";
import { MailboxRouter } from "./mailbox.router";
import { MailboxApiClient } from "./mailbox-api.client";
import { MailboxMatchService } from "./mailbox-match.service";
import { MailboxTokenService } from "./mailbox-token.service";
import { PurelymailImapService } from "./purelymail-imap.service";
import { SyncStateService } from "./sync-state.service";
import { ThreadWriterService } from "./thread-writer.service";

@Module({
	imports: [
		AgentModule,
		BusinessUnitsModule,
		CompaniesModule,
		EmailIngestModule,
	],
	providers: [
		MailboxApiClient,
		MailboxTokenService,
		MailboxMatchService,
		HistoricalEmailImportService,
		MailboxRouter,
		SyncStateService,
		ThreadWriterService,
		PurelymailImapService,
	],
	exports: [
		MailboxApiClient,
		MailboxTokenService,
		MailboxMatchService,
		HistoricalEmailImportService,
		SyncStateService,
		ThreadWriterService,
		PurelymailImapService,
	],
})
export class MailboxModule {}
