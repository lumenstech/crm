import { describe, expect, it } from "bun:test";

type TurboConfig = {
	globalPassThroughEnv?: string[];
	tasks?: Record<string, { passThroughEnv?: string[] }>;
};

async function readJson(path: string): Promise<TurboConfig> {
	return (await Bun.file(new URL(path, import.meta.url)).json()) as TurboConfig;
}

describe("Purelymail runtime environment wiring", () => {
	it("passes only the encrypted credential key through API tasks", async () => {
		const root = await readJson("../../../turbo.json");
		const api = await readJson("../turbo.json");

		expect(root.globalPassThroughEnv).toContain("PURELYMAIL_CREDENTIAL_KEY");
		expect(root.globalPassThroughEnv).not.toContain("PURELYMAIL_IMAP_PASSWORD");
		expect(root.globalPassThroughEnv).not.toContain(
			"PURELYMAIL_SYNC_USER_EMAIL",
		);
		expect(api.tasks?.dev?.passThroughEnv).toContain(
			"PURELYMAIL_CREDENTIAL_KEY",
		);
		expect(api.tasks?.test?.passThroughEnv).toContain(
			"PURELYMAIL_CREDENTIAL_KEY",
		);
	});
});
