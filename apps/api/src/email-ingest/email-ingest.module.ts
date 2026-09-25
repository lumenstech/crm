import { Module } from "@nestjs/common";
import { BusinessUnitsModule } from "../business-units/business-units.module";
import { CompaniesModule } from "../companies/companies.module";
import { ContactsModule } from "../contacts/contacts.module";
import { IngestModule } from "../ingest/ingest.module";
import { EmailIngestController } from "./email-ingest.controller";
import { EmailIngestService } from "./email-ingest.service";
import { MailboxEmailIngestService } from "./mailbox-email-ingest.service";

@Module({
	imports: [BusinessUnitsModule, CompaniesModule, ContactsModule, IngestModule],
	controllers: [EmailIngestController],
	providers: [EmailIngestService, MailboxEmailIngestService],
	exports: [EmailIngestService, MailboxEmailIngestService],
})
export class EmailIngestModule {}
