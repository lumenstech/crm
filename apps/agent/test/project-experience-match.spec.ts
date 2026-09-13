import { describe, expect, test } from "bun:test";
import { scoreProjectExperience } from "../agent/lib/project-experience-score";

const project = {
	projectName: "Retail lighting controls rollout",
	clientLabel: "National Retailer",
	sector: "Retail",
	projectType: "Lighting controls",
	scopeSummary: "Installed networked lighting controls across occupied stores.",
	systems: "LED fixtures, occupancy sensors, controls",
	portfolioLanguage: "Multi-site retail retrofit delivery.",
	evidenceStrength: "high",
	salesEligible: true,
	tags: ["retail", "lighting controls", "multi-site rollout"],
};

describe("project experience matching", () => {
	test("scores shared capability terms", () => {
		const result = scoreProjectExperience(
			"Retail lighting controls retrofit across 20 stores",
			project,
		);

		expect(result?.score).toBeGreaterThanOrEqual(40);
		expect(result?.matchedSignals).toContain("lighting controls");
	});

	test("rejects projects without shared terms", () => {
		const result = scoreProjectExperience(
			"Healthcare payroll data migration",
			project,
		);

		expect(result).toBeNull();
	});
});
