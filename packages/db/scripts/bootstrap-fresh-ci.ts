import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const packageRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const schemaPath = path.join(packageRoot, "prisma", "schema.prisma");
const databaseUrl = process.env.DATABASE_URL;

if (process.env.CI !== "true" || process.env.FRESH_CI_BOOTSTRAP !== "true") {
	throw new Error("Fresh CI bootstrap is only available from the CI workflow.");
}

if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const parsedUrl = new URL(databaseUrl);
const databaseName = parsedUrl.pathname.replace(/^\//, "");
if (
	!databaseName.endsWith("_test") ||
	!new Set(["localhost", "127.0.0.1", "::1"]).has(parsedUrl.hostname) ||
	parsedUrl.searchParams.get("schema") !== "public"
) {
	throw new Error("Fresh CI bootstrap refuses this database target.");
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
	const [{ rows: relations }, { rows: migrations }] = await Promise.all([
		client.query<{ count: string }>(`
			SELECT count(*)::text AS count
			FROM pg_class AS relation
			JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
			WHERE namespace.nspname = 'public'
				AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
		`),
		client.query<{ migration: string | null }>(
			`SELECT to_regclass('public._prisma_migrations') AS migration`,
		),
	]);
	if (relations[0]?.count !== "0" || migrations[0]?.migration !== null) {
		throw new Error("Fresh CI bootstrap refuses a non-empty database.");
	}

	const sql = await prismaDiff();
	if (!/CREATE TABLE/i.test(sql)) {
		throw new Error("Fresh CI bootstrap did not generate a table definition.");
	}

	await client.query("BEGIN");
	try {
		await client.query(sql);
		await client.query("COMMIT");
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	}

	const expectedTables = [
		"company",
		"emailThread",
		"emailMessage",
		"oauthClient",
		"oauthAccessToken",
		"oauthConsent",
	];
	const result = await client.query<{ table_name: string }>(
		`
			SELECT table_name
			FROM information_schema.tables
			WHERE table_schema = 'public' AND table_name = ANY($1::text[])
		`,
		[expectedTables],
	);
	const actualTables = new Set(result.rows.map((row) => row.table_name));
	const missing = expectedTables.filter((table) => !actualTables.has(table));
	if (missing.length > 0) {
		throw new Error(
			`Fresh CI bootstrap is missing tables: ${missing.join(", ")}`,
		);
	}

	console.log(
		`Fresh CI bootstrap applied the current schema to ${databaseName}; migration deploy is validated separately.`,
	);
} finally {
	await client.end();
}

async function prismaDiff(): Promise<string> {
	const child = spawn(
		"bunx",
		[
			"prisma",
			"migrate",
			"diff",
			"--from-empty",
			`--to-schema=${schemaPath}`,
			"--script",
		],
		{
			cwd: packageRoot,
			env: { ...process.env, DATABASE_URL: databaseUrl },
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	const [stdout, stderr, exitCode] = await Promise.all([
		streamText(child.stdout),
		streamText(child.stderr),
		processExit(child),
	]);
	if (exitCode !== 0) {
		throw new Error(`Prisma schema diff failed: ${stderr || stdout}`);
	}
	return stdout;
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
