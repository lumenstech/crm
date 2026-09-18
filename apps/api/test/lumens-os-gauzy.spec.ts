import { describe, expect, test } from "bun:test";
import type { GauzyAdapter } from "../src/lumens-os/gauzy.adapter";

class FakeGauzy implements GauzyAdapter {
	organizations = 0;
	customers = 0;
	contacts = 0;
	projects = 0;
	failProjectOnce = false;

	async findOrCreateOrganization() {
		this.organizations += 1;
		return { id: "org-1" };
	}
	async findOrCreateCustomer() {
		this.customers += 1;
		return { id: "customer-1" };
	}
	async findOrCreateContact() {
		this.contacts += 1;
		return { id: "contact-1" };
	}
	async findOrCreateProject() {
		this.projects += 1;
		if (this.failProjectOnce) {
			this.failProjectOnce = false;
			throw new Error("synthetic transient Gauzy failure");
		}
		return { id: "project-1" };
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

	test("transient project failure can be retried", async () => {
		const gauzy = new FakeGauzy();
		gauzy.failProjectOnce = true;
		await expect(gauzy.findOrCreateProject({ canonicalOpportunityId: "opp", customerId: "customer-1", organizationId: "org-1", name: "Project" })).rejects.toThrow("synthetic transient Gauzy failure");
		expect((await gauzy.findOrCreateProject({ canonicalOpportunityId: "opp", customerId: "customer-1", organizationId: "org-1", name: "Project" })).id).toBe("project-1");
		expect(gauzy.projects).toBe(2);
	});
});
