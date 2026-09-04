export type IngestEntity = {
	name: string;
	domain?: string;
	website?: string;
	email?: string;
	phone?: string;
	city?: string;
	stateCode?: string;
	countryCode?: string;
};

export type IngestContact = {
	firstName: string;
	lastName?: string;
	email?: string;
	phone?: string;
	title?: string;
	linkedinUrl?: string;
};

export type IngestSignalRequest = {
	eventId: string;
	project: string;
	source: string;
	sourceType: string;
	title: string;
	description?: string;
	url?: string;
	observedAt?: string;
	score?: number;
	tags?: string[];
	entity?: IngestEntity;
	contact?: IngestContact;
	payload?: Record<string, unknown>;
};

export type IngestSignalResult = {
	status: "accepted" | "duplicate";
	eventId: string;
	signalId?: string;
	companyId?: string;
	contactId?: string;
	agentTaskId?: string;
};
