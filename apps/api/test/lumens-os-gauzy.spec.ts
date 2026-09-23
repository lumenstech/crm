import { describe, expect, test } from "bun:test";
import type { GauzyAdapter } from "../src/lumens-os/gauzy.adapter";

class FakeGauzy implements GauzyAdapter {
	organizations = 0;
	customers = 0;
	contacts = 0;
	projects = 0;
	tasks = 0;
	assignments = 0;
	schedules = 0;
	failProjectOnce = false;

	async findOrCreateOrganization(_input: Parameters<GauzyAdapter["findOrCreateOrganization"]>[0]) {
		this.organizations += 1;
		return { id: "org-1" };
	}
	async findOrCreateCustomer(_input: Parameters<GauzyAdapter["findOrCreateCustomer"]>[0]) {
		this.customers += 1;
		return { id: "customer-1" };
	}
	async findOrCreateContact(_input: Parameters<GauzyAdapter["findOrCreateContact"]>[0]) {
		this.contacts += 1;
		return { id: "contact-1" };
	}
	async findOrCreateProject(_input: Parameters<GauzyAdapter["findOrCreateProject"]>[0]) {
		this.projects += 1;
		if (this.failProjectOnce) {
			this.failProjectOnce = false;
			throw new Error("synthetic transient Gauzy failure");
		}
		return { id: "project-1" };
	}
	async findOrCreateTask(_input: Parameters<GauzyAdapter["findOrCreateTask"]>[0]) {
		this.tasks += 1;
		return { id: "task-1" };
	}
	async assignTask(_input: Parameters<GauzyAdapter["assignTask"]>[0]) {
		this.assignments += 1;
		return { id: "assignment-1" };
	}
	async upsertSchedule(_input: Parameters<GauzyAdapter["upsertSchedule"]>[0]) {
		this.schedules += 1;
		return { id: "schedule-1" };
	}
}

describe("Lumens OS Gauzy contract", () => {
	test("adapter supports organization, customer, contact and project promotion", async () => {
		const gauzy = new FakeGauzy();
		expect((await gauzy.findOrCreateOrganization({ canonicalBusinessUnitId: "bu", name: "Lumens" })).id).toBe("org-1");
		expect((await gauzy.findOrCreateCustomer({ canonicalCompanyId: "co", organizationId: "org-1", name: "Customer" })).id).toBe("customer-1");
		expect((await gauzy.findOrCreateContact({ canonicalPersonId: "p", customerId: "customer-1", organizationId: "org-1", firstName: "Test" })).id).toBe("contact-1");
		expect((await gauzy.findOrCreateProject({ canonicalOpportunityId: "opp", customerId: "customer-1", organizationId: "org-1", name: "Project" })).id).toBe("project-1");
	});

	test("adapter exposes task, assignment and scheduling operations", async () => {
		const gauzy = new FakeGauzy();
		expect((await gauzy.findOrCreateTask({ canonicalTaskId: "task", projectId: "project-1", organizationId: "org-1", title: "Install equipment" })).id).toBe("task-1");
		expect((await gauzy.assignTask({ canonicalAssignmentId: "assignment", taskId: "task-1", organizationId: "org-1", employeeId: "employee-1" })).id).toBe("assignment-1");
		expect((await gauzy.upsertSchedule({ canonicalScheduleId: "schedule", taskId: "task-1", organizationId: "org-1", startAt: new Date("2026-09-18T13:00:00Z") })).id).toBe("schedule-1");
	});

	test("transient project failure can be retried", async () => {
		const gauzy = new FakeGauzy();
		gauzy.failProjectOnce = true;
		await expect(gauzy.findOrCreateProject({ canonicalOpportunityId: "opp", customerId: "customer-1", organizationId: "org-1", name: "Project" })).rejects.toThrow("synthetic transient Gauzy failure");
		expect((await gauzy.findOrCreateProject({ canonicalOpportunityId: "opp", customerId: "customer-1", organizationId: "org-1", name: "Project" })).id).toBe("project-1");
		expect(gauzy.projects).toBe(2);
	});
});
