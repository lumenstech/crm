import { Module } from "@nestjs/common";
import { BusinessUnitsModule } from "../business-units/business-units.module";
import { CompaniesModule } from "../companies/companies.module";
import { ContactsModule } from "../contacts/contacts.module";
import { EmailIngestController } from "./email-ingest.controller";
import { EmailIngestService } from "./email-ingest.service";

@Module({
	imports: [BusinessUnitsModule, CompaniesModule, ContactsModule],
	controllers: [EmailIngestController],
	providers: [EmailIngestService],
	exports: [EmailIngestService],
})
export class EmailIngestModule {}
