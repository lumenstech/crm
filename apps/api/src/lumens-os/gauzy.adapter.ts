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

export type GauzyTaskInput = {
	canonicalTaskId: string;
	projectId: string;
	organizationId: string;
	title: string;
	description?: string | null;
};

export type GauzyAssignmentInput = {
	canonicalAssignmentId: string;
	taskId: string;
	organizationId: string;
	employeeId: string;
};

export type GauzyScheduleInput = {
	canonicalScheduleId: string;
	taskId: string;
	organizationId: string;
	startAt: Date;
	endAt?: Date | null;
};

export interface GauzyAdapter {
	findOrCreateOrganization(input: GauzyOrganizationInput): Promise<ExternalEntity>;
	findOrCreateCustomer(input: GauzyCustomerInput): Promise<ExternalEntity>;
	findOrCreateContact(input: GauzyContactInput): Promise<ExternalEntity>;
	findOrCreateProject(input: GauzyProjectInput): Promise<ExternalEntity>;
	findOrCreateTask(input: GauzyTaskInput): Promise<ExternalEntity>;
	assignTask(input: GauzyAssignmentInput): Promise<ExternalEntity>;
	upsertSchedule(input: GauzyScheduleInput): Promise<ExternalEntity>;
}
