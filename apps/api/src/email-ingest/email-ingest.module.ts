import { Module } from "@nestjs/common";
import { BusinessUnitsModule } from "../business-units/business-units.module";
import { CompaniesModule } from "../companies/companies.module";
import { ContactsModule } from "../contacts/contacts.module";
import { IngestModule } from "../ingest/ingest.module";
import { EmailIngestController } from "./email-ingest.controller";
import { EmailIngestService } from "./email-ingest.service";
import { InboundMessageService } from "./inbound-message.service";
import { MailboxEmailIngestService } from "./mailbox-email-ingest.service";
import { WhatsappIngressController } from "./whatsapp-ingress.controller";

@Module({
	imports: [BusinessUnitsModule, CompaniesModule, ContactsModule, IngestModule],
	controllers: [EmailIngestController, WhatsappIngressController],
	providers: [
		EmailIngestService,
		MailboxEmailIngestService,
		InboundMessageService,
	],
	exports: [
		EmailIngestService,
		MailboxEmailIngestService,
		InboundMessageService,
	],
})
export class EmailIngestModule {}
