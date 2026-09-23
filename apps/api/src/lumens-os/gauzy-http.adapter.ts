import { Injectable } from "@nestjs/common";
import type {
	ExternalEntity,
	GauzyAdapter,
	GauzyContactInput,
	GauzyCustomerInput,
	GauzyOrganizationInput,
	GauzyProjectInput,
	GauzyTaskInput,
	GauzyAssignmentInput,
	GauzyScheduleInput,
} from "./gauzy.adapter";

type JsonRecord = Record<string, unknown>;

export type GauzyHttpConfig = {
	baseUrl: string;
	email: string;
	password: string;
	tenantId?: string;
	currency?: string;
};

@Injectable()
export class GauzyHttpAdapter implements GauzyAdapter {
	private token: string | null = null;

	constructor(private readonly config: GauzyHttpConfig) {}

	async findOrCreateOrganization(input: GauzyOrganizationInput): Promise<ExternalEntity> {
		const existing = await this.findOne("/organization", input.name);
		if (existing) return existing;
		return this.post("/organization", {
			name: input.name,
			currency: this.config.currency ?? "USD",
			...(this.config.tenantId ? { tenantId: this.config.tenantId } : {}),
		});
	}

	async findOrCreateCustomer(input: GauzyCustomerInput): Promise<ExternalEntity> {
		// Gauzy models customers/clients as organization contacts.
		const existing = await this.findOne("/organization-contact", input.name);
		if (existing) return existing;
		return this.post("/organization-contact", {
			name: input.name,
			organizationId: input.organizationId,
			primaryEmail: input.email ?? undefined,
			primaryPhone: input.phone ?? undefined,
			contactType: "CLIENT",
			...(this.config.tenantId ? { tenantId: this.config.tenantId } : {}),
		});
	}

	async findOrCreateContact(input: GauzyContactInput): Promise<ExternalEntity> {
		const name = [input.firstName, input.lastName].filter(Boolean).join(" ") || input.email || input.canonicalPersonId;
		const existing = await this.findOne("/organization-contact", name);
		if (existing) return existing;
		return this.post("/organization-contact", {
			name,
			organizationId: input.organizationId,
			primaryEmail: input.email ?? undefined,
			primaryPhone: input.phone ?? undefined,
			contactType: "CLIENT",
			...(this.config.tenantId ? { tenantId: this.config.tenantId } : {}),
		});
	}

	async findOrCreateProject(input: GauzyProjectInput): Promise<ExternalEntity> {
		const existing = await this.findOne("/organization-projects", input.name);
		if (existing) return existing;
		return this.post("/organization-projects", {
			name: input.name,
			organizationId: input.organizationId,
			...(this.config.tenantId ? { tenantId: this.config.tenantId } : {}),
		});
	}

	async findOrCreateTask(input: GauzyTaskInput): Promise<ExternalEntity> {
		const existing = await this.findOne("/tasks", input.title);
		if (existing) return existing;
		return this.post("/tasks", {
			title: input.title,
			description: input.description ?? undefined,
			projectId: input.projectId,
			organizationId: input.organizationId,
			...(this.config.tenantId ? { tenantId: this.config.tenantId } : {}),
		});
	}

	async assignTask(input: GauzyAssignmentInput): Promise<ExternalEntity> {
		return this.put(`/tasks/${input.taskId}`, {
			organizationId: input.organizationId,
			members: [{ id: input.employeeId }],
			...(this.config.tenantId ? { tenantId: this.config.tenantId } : {}),
		});
	}

	async upsertSchedule(input: GauzyScheduleInput): Promise<ExternalEntity> {
		return this.put(`/tasks/${input.taskId}`, {
			organizationId: input.organizationId,
			startDate: input.startAt.toISOString(),
			dueDate: input.endAt?.toISOString(),
			...(this.config.tenantId ? { tenantId: this.config.tenantId } : {}),
		});
	}

	private async findOne(path: string, name: string): Promise<ExternalEntity | null> {
		const encoded = encodeURIComponent(JSON.stringify({ where: { name } }));
		const response = await this.request<JsonRecord>(`${path}?data=${encoded}`, { method: "GET" });
		const items = this.items(response);
		const match = items.find((item) => item.name === name && typeof item.id === "string");
		return match ? { id: match.id as string } : null;
	}

	private async post(path: string, body: JsonRecord): Promise<ExternalEntity> {
		return this.write(path, "POST", body);
	}

	private async put(path: string, body: JsonRecord): Promise<ExternalEntity> {
		return this.write(path, "PUT", body);
	}

	private async write(path: string, method: "POST" | "PUT", body: JsonRecord): Promise<ExternalEntity> {
		const result = await this.request<JsonRecord>(path, {
			method,
			body: JSON.stringify(body),
		});
		if (typeof result.id !== "string") throw new GauzyHttpError(502, `Gauzy ${path} response had no id.`);
		return { id: result.id };
	}

	private items(value: JsonRecord): JsonRecord[] {
		const candidates = [value.items, value.data, value];
		for (const candidate of candidates) {
			if (Array.isArray(candidate)) return candidate.filter((item): item is JsonRecord => !!item && typeof item === "object");
		}
		return [];
	}

	private async request<T extends JsonRecord>(path: string, init: RequestInit, retryAuth = true): Promise<T> {
		const token = await this.accessToken();
		const response = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/api${path}`, {
			...init,
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${token}`,
				...(init.headers ?? {}),
			},
		});
		if (response.status === 401 && retryAuth) {
			this.token = null;
			return this.request<T>(path, init, false);
		}
		const text = await response.text();
		const body = text ? JSON.parse(text) : {};
		if (!response.ok) throw new GauzyHttpError(response.status, body?.message ?? text ?? response.statusText);
		return body as T;
	}

	private async accessToken(): Promise<string> {
		if (this.token) return this.token;
		const response = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/api/auth/login`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: this.config.email, password: this.config.password }),
		});
		const text = await response.text();
		const body = text ? JSON.parse(text) : {};
		if (!response.ok) throw new GauzyHttpError(response.status, body?.message ?? text ?? response.statusText);
		const token = body.token ?? body.access_token ?? body.accessToken;
		if (typeof token !== "string" || !token) throw new GauzyHttpError(502, "Gauzy login returned no access token.");
		this.token = token;
		return token;
	}
}

export class GauzyHttpError extends Error {
	constructor(readonly status: number, message: string) {
		super(message);
	}
}
