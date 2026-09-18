export type ExternalEntity = { id: string };

export type GauzyOrganizationInput = {
	canonicalBusinessUnitId: string;
	name: string;
};

export type GauzyCustomerInput = {
	canonicalCompanyId: string;
	organizationId: string;
	name: string;
	email?: string | null;
	phone?: string | null;
};

export type GauzyContactInput = {
	canonicalPersonId: string;
	customerId: string;
	organizationId: string;
	firstName?: string | null;
	lastName?: string | null;
	email?: string | null;
	phone?: string | null;
};

export type GauzyProjectInput = {
	canonicalOpportunityId: string;
	customerId: string;
	organizationId: string;
	name: string;
};

export interface GauzyAdapter {
	findOrCreateOrganization(input: GauzyOrganizationInput): Promise<ExternalEntity>;
	findOrCreateCustomer(input: GauzyCustomerInput): Promise<ExternalEntity>;
	findOrCreateContact(input: GauzyContactInput): Promise<ExternalEntity>;
	findOrCreateProject(input: GauzyProjectInput): Promise<ExternalEntity>;
}
