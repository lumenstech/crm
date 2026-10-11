import { z } from "zod";

const historicalMailboxSource = z.enum(["gmail", "outlook"]);

const exactEmail = z
	.string()
	.trim()
	.email()
	.max(320)
	.transform((value) => value.toLowerCase());

const businessUnitKey = z
	.string()
	.trim()
	.min(1)
	.max(96)
	.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const historicalMailboxBinding = z
	.object({
		userId: z.string().trim().min(1).max(160),
		source: historicalMailboxSource,
		mailbox: exactEmail,
	})
	.strict();

const verifiedSenderBusinessUnit = z
	.object({
		email: exactEmail,
		businessUnit: businessUnitKey,
	})
	.strict();

export type HistoricalMailboxBinding = z.infer<typeof historicalMailboxBinding>;

export type VerifiedSenderBusinessUnit = z.infer<
	typeof verifiedSenderBusinessUnit
>;

const defaultVerifiedSenderBusinessUnits: readonly VerifiedSenderBusinessUnit[] =
	[{ email: "sales@data-gear.com", businessUnit: "data-gear" }];

function parseJson(raw: string, name: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		throw new Error(`${name} must be valid JSON.`);
	}
}

function formatIssues(error: z.ZodError): string {
	return error.issues
		.map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`)
		.join("; ");
}

export function parseHistoricalMailboxBindings(
	raw?: string,
): readonly HistoricalMailboxBinding[] {
	if (!raw?.trim()) return [];

	const parsed = z
		.array(historicalMailboxBinding)
		.max(100)
		.safeParse(parseJson(raw, "CRM_HISTORICAL_MAILBOX_BINDINGS_JSON"));
	if (!parsed.success) {
		throw new Error(
			`CRM_HISTORICAL_MAILBOX_BINDINGS_JSON is invalid: ${formatIssues(parsed.error)}`,
		);
	}

	const seen = new Map<string, string>();
	for (const binding of parsed.data) {
		const mailboxKey = `${binding.source}:${binding.mailbox}`;
		const existingOwner = seen.get(mailboxKey);
		if (existingOwner) {
			throw new Error(
				`CRM_HISTORICAL_MAILBOX_BINDINGS_JSON has ambiguous ownership for ${mailboxKey} (${existingOwner} and ${binding.userId}).`,
			);
		}
		seen.set(mailboxKey, binding.userId);
	}

	return parsed.data;
}

export function isHistoricalMailboxAuthorized(
	bindings: readonly HistoricalMailboxBinding[],
	input: {
		userId: string;
		userEmail: string;
		source: HistoricalMailboxBinding["source"];
		mailbox: string;
	},
): boolean {
	const userEmail = input.userEmail.trim().toLowerCase();
	const mailbox = input.mailbox.trim().toLowerCase();
	if (mailbox === userEmail) return true;

	return bindings.some(
		(binding) =>
			binding.userId === input.userId &&
			binding.source === input.source &&
			binding.mailbox === mailbox,
	);
}

export function parseVerifiedSenderBusinessUnits(
	raw?: string,
): readonly VerifiedSenderBusinessUnit[] {
	if (!raw?.trim()) return defaultVerifiedSenderBusinessUnits;

	const parsed = z
		.array(verifiedSenderBusinessUnit)
		.max(100)
		.safeParse(parseJson(raw, "CRM_VERIFIED_SENDER_BUSINESS_UNITS_JSON"));
	if (!parsed.success) {
		throw new Error(
			`CRM_VERIFIED_SENDER_BUSINESS_UNITS_JSON is invalid: ${formatIssues(parsed.error)}`,
		);
	}

	const byEmail = new Map(
		defaultVerifiedSenderBusinessUnits.map((row) => [
			row.email,
			row.businessUnit,
		]),
	);
	for (const row of parsed.data) {
		const existing = byEmail.get(row.email);
		if (existing && existing !== row.businessUnit) {
			throw new Error(
				`CRM_VERIFIED_SENDER_BUSINESS_UNITS_JSON has ambiguous ownership for ${row.email} (${existing} and ${row.businessUnit}).`,
			);
		}
		byEmail.set(row.email, row.businessUnit);
	}

	return [...byEmail].map(([email, businessUnit]) => ({
		email,
		businessUnit,
	}));
}
