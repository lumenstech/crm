import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cp,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const packageRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const migrationsRoot = path.join(packageRoot, "prisma", "migrations");
const databaseUrl = process.env.DATABASE_URL;
const legacyMigration = "20261001213000_add_mcp_oauth_models";
const canonicalMigration = "20261001193000_claude_oauth";
const importerMigration = "20261010190000_historical_email_provider_ids";

if (
	process.env.CI !== "true" ||
	process.env.MIGRATION_UPGRADE_VERIFY !== "true"
) {
	throw new Error("Upgrade migration verification is only available from CI.");
}

if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const baseUrl = new URL(databaseUrl);
const databaseName = baseUrl.pathname.replace(/^\//, "");
if (
	!databaseName.endsWith("_test") ||
	!new Set(["localhost", "127.0.0.1", "::1"]).has(baseUrl.hostname)
) {
	throw new Error(
		"Upgrade migration verification refuses this database target.",
	);
}

const fixtureDatabaseName = `crm_upgrade_${process.pid}_${Date.now()}_test`;
const fixtureUrl = new URL(databaseUrl);
fixtureUrl.pathname = `/${fixtureDatabaseName}`;
fixtureUrl.searchParams.set("schema", "public");
const adminUrl = new URL(databaseUrl);
adminUrl.pathname = "/postgres";
adminUrl.searchParams.delete("schema");
const tempRoot = await mkdtemp(
	path.join(packageRoot, ".ci-migration-fixture-"),
);
let fixtureCreated = false;

try {
	await createDatabase(adminUrl.toString(), fixtureDatabaseName);
	fixtureCreated = true;
	const configPath = await createLegacyFirstConfig(tempRoot);
	await runPrisma(
		["migrate", "deploy", "--config", configPath],
		fixtureUrl.toString(),
	);
	await runPrisma(["migrate", "deploy"], fixtureUrl.toString());
	await verifyFixture(fixtureUrl.toString());
	console.log(
		`Upgrade fixture applied legacy ${legacyMigration}, canonical ${canonicalMigration}, and importer ${importerMigration}.`,
	);
} finally {
	if (fixtureCreated) {
		await dropDatabase(adminUrl.toString(), fixtureDatabaseName);
	}
	await rm(tempRoot, { recursive: true, force: true });
}

async function createLegacyFirstConfig(tempRoot: string): Promise<string> {
	const migrationPath = path.join(tempRoot, "migrations");
	await mkdir(migrationPath);
	await cp(
		path.join(migrationsRoot, "migration_lock.toml"),
		path.join(migrationPath, "migration_lock.toml"),
	);
	const entries = await readdir(migrationsRoot, { withFileTypes: true });
	for (const entry of entries) {
		if (
			!entry.isDirectory() ||
			(entry.name >= canonicalMigration && entry.name !== legacyMigration)
		) {
			continue;
		}
		await cp(
			path.join(migrationsRoot, entry.name),
			path.join(migrationPath, entry.name),
			{ recursive: true },
		);
	}
	await cp(
		path.join(migrationsRoot, legacyMigration),
		path.join(migrationPath, legacyMigration),
		{ recursive: true },
	);

	const configPath = path.join(tempRoot, "prisma.config.ts");
	await writeFile(
		configPath,
		[
			'import { defineConfig, env } from "prisma/config";',
			"",
			"export default defineConfig({",
			`\tschema: ${JSON.stringify(path.join(packageRoot, "prisma", "schema.prisma"))},`,
			"\tmigrations: {",
			`\t\tpath: ${JSON.stringify(migrationPath)},`,
			"\t},",
			'\tdatasource: { url: env("DATABASE_URL") },',
			"});",
		].join("\n"),
	);
	return configPath;
}

async function runPrisma(args: string[], targetUrl: string): Promise<void> {
	const child = spawn("bunx", ["prisma", ...args], {
		cwd: packageRoot,
		env: { ...process.env, DATABASE_URL: targetUrl },
		stdio: ["ignore", "pipe", "pipe"],
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		streamText(child.stdout),
		streamText(child.stderr),
		processExit(child),
	]);
	if (exitCode !== 0) {
		throw new Error(`Prisma ${args.join(" ")} failed: ${stderr || stdout}`);
	}
}

async function createDatabase(
	targetUrl: string,
	database: string,
): Promise<void> {
	const client = new pg.Client({ connectionString: targetUrl });
	await client.connect();
	try {
		await client.query(`CREATE DATABASE "${database}"`);
	} finally {
		await client.end();
	}
}

async function dropDatabase(
	targetUrl: string,
	database: string,
): Promise<void> {
	const client = new pg.Client({ connectionString: targetUrl });
	await client.connect();
	try {
		await client.query(
			"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
			[database],
		);
		await client.query(`DROP DATABASE IF EXISTS "${database}"`);
	} finally {
		await client.end();
	}
}

async function verifyFixture(targetUrl: string): Promise<void> {
	const client = new pg.Client({ connectionString: targetUrl });
	await client.connect();
	try {
		const rows = await client.query<{
			migration_name: string;
			checksum: string;
			finished_at: Date | null;
			started_at: Date;
		}>(
			`SELECT migration_name, checksum, finished_at, started_at FROM "_prisma_migrations" WHERE migration_name = ANY($1::text[])`,
			[[legacyMigration, canonicalMigration, importerMigration]],
		);
		const byName = new Map<string, (typeof rows.rows)[number]>();
		for (const row of rows.rows) byName.set(row.migration_name, row);
		for (const migration of [
			legacyMigration,
			canonicalMigration,
			importerMigration,
		]) {
			const row = byName.get(migration);
			if (!row?.finished_at) {
				throw new Error(
					`Migration ${migration} is not finished in the fixture.`,
				);
			}
			const expected = await migrationChecksum(migration);
			if (row.checksum !== expected) {
				throw new Error(`Migration ${migration} checksum differs from disk.`);
			}
		}
		const legacy = byName.get(legacyMigration);
		const canonical = byName.get(canonicalMigration);
		if (!legacy || !canonical || legacy.started_at >= canonical.started_at) {
			throw new Error(
				"The fixture did not prove legacy-first canonical upgrade order.",
			);
		}

		const objects = await client.query<{ table_name: string }>(
			`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = ANY($2::text[])`,
			["public", ["oauthApplication", "oauthClient", "emailThread"]],
		);
		const actual = new Set(objects.rows.map((row) => row.table_name));
		for (const table of ["oauthApplication", "oauthClient", "emailThread"]) {
			if (!actual.has(table)) throw new Error(`Fixture is missing ${table}.`);
		}
		const columns = await client.query<{ column_name: string }>(
			`SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'emailThread' AND column_name = ANY($2::text[])`,
			["public", ["provider", "mailbox", "providerThreadId"]],
		);
		if (columns.rows.length !== 3) {
			throw new Error(
				"Importer migration columns are incomplete in the fixture.",
			);
		}
	} finally {
		await client.end();
	}
}

async function migrationChecksum(name: string): Promise<string> {
	const sql = await readFile(
		path.join(migrationsRoot, name, "migration.sql"),
		"utf8",
	);
	return createHash("sha256").update(sql).digest("hex");
}

function processExit(child: ReturnType<typeof spawn>): Promise<number> {
	return new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code) => resolve(code ?? 1));
	});
}

function streamText(stream: NodeJS.ReadableStream | null): Promise<string> {
	if (!stream) return Promise.resolve("");
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		stream.on("data", (chunk: Buffer | string) => {
			chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		});
		stream.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		stream.once("error", reject);
	});
}
