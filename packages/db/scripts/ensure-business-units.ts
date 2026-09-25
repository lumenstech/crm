import { db } from "../src/index";

const UNITS = [
	{
		key: "lumens-technology",
		name: "Lumens Technology",
		description:
			"Lumens Technology systems, MEP, controls, security, and New York operations.",
	},
	{
		key: "energybms",
		name: "EnergyBMS",
		description:
			"EnergyBMS building energy management, controls, metering, optimization, and LL97-related opportunities.",
	},
	{
		key: "data-gear",
		name: "Data-Gear",
		description:
			"Data-Gear GPU, server, data center, infrastructure, and hardware opportunities.",
	},
	{
		key: "trustaccept",
		name: "TrustAccept",
		description:
			"TrustAccept identity, authorization, orchestration, and software partnerships.",
	},
	{
		key: "516labs",
		name: "516Labs",
		description:
			"516Labs testing, compliance, and laboratory-service opportunities.",
	},
	{
		key: "partwall",
		name: "PartWall",
		description:
			"PartWall trade show, display, wall, fabrication, and installation opportunities.",
	},
] as const;

async function main() {
	const results = [];

	for (const unit of UNITS) {
		const existing = await db.businessUnit.findUnique({
			where: { key: unit.key },
			select: { id: true, key: true, name: true, enabled: true },
		});

		if (existing) {
			const row = await db.businessUnit.update({
				where: { key: unit.key },
				data: {
					name: unit.name,
					description: unit.description,
					enabled: true,
				},
				select: { id: true, key: true, name: true, enabled: true },
			});
			results.push({ action: "existing", ...row });
			continue;
		}

		const byName = await db.businessUnit.findFirst({
			where: {
				name: { equals: unit.name, mode: "insensitive" },
			},
			select: { id: true, key: true, name: true, enabled: true },
		});

		if (byName) {
			results.push({
				action: "name-match-no-change",
				expectedKey: unit.key,
				...byName,
			});
			continue;
		}

		const row = await db.businessUnit.create({
			data: unit,
			select: { id: true, key: true, name: true, enabled: true },
		});
		results.push({ action: "created", ...row });
	}

	const all = await db.businessUnit.findMany({
		where: { enabled: true },
		orderBy: { key: "asc" },
		select: { id: true, key: true, name: true, enabled: true },
	});

	console.log(JSON.stringify({ results, enabledBusinessUnits: all }, null, 2));
}

main()
	.catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	})
	.finally(async () => {
		await db.$disconnect();
	});
