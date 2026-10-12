import { EXCLUDED_MAILBOX } from "@crm/db/mailbox-privacy";
import { z } from "zod";

const mailboxSource = z.enum(["gmail", "outlook", "purelymail"]);

const exactEmail = z
	.string()
	.trim()
	.email()
	.max(320)
	.transform((value) => value.toLowerCase());

const excludedMailbox = z
	.object({
		userId: z.string().trim().min(1).max(160),
		source: mailboxSource,
		mailbox: exactEmail,
	})
	.strict();

export type ExcludedMailbox = z.infer<typeof excludedMailbox>;

const defaultExcludedMailboxes: readonly ExcludedMailbox[] = [EXCLUDED_MAILBOX];

function parseJson(raw: string, name: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		throw new Error(`${name} must be valid JSON.`);
	}
}

export function parseExcludedMailboxes(
	raw?: string,
): readonly ExcludedMailbox[] {
	const configured = raw?.trim()
		? z
				.array(excludedMailbox)
				.max(100)
				.parse(parseJson(raw, "CRM_EXCLUDED_MAILBOXES_JSON"))
		: [];

	const seen = new Set<string>();
	return [...defaultExcludedMailboxes, ...configured].filter((row) => {
		const key = `${row.userId}:${row.source}:${row.mailbox}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

export function excludedMailboxesForUser(
	userId: string,
	raw = process.env.CRM_EXCLUDED_MAILBOXES_JSON,
): readonly ExcludedMailbox[] {
	return parseExcludedMailboxes(raw).filter((row) => row.userId === userId);
}

export function excludedMailboxesForReader(
	userId: string,
	raw = process.env.CRM_EXCLUDED_MAILBOXES_JSON,
): readonly ExcludedMailbox[] {
	const rows = [
		...defaultExcludedMailboxes,
		...parseExcludedMailboxes(raw).filter((row) => row.userId === userId),
	];
	const seen = new Set<string>();
	return rows.filter((row) => {
		const key = `${row.userId}:${row.source}:${row.mailbox}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

export function isMailboxExcluded(
	userId: string,
	source: string,
	mailbox: string,
	raw = process.env.CRM_EXCLUDED_MAILBOXES_JSON,
): boolean {
	const normalizedMailbox = mailbox.trim().toLowerCase();
	return excludedMailboxesForReader(userId, raw).some(
		(row) => row.source === source && row.mailbox === normalizedMailbox,
	);
}

export function hasExcludedMailboxForSource(
	userId: string,
	source: string,
	raw = process.env.CRM_EXCLUDED_MAILBOXES_JSON,
): boolean {
	return excludedMailboxesForReader(userId, raw).some(
		(row) => row.source === source,
	);
}

export function isOwnedMailboxExcluded(
	userId: string,
	source: string,
	mailbox: string,
	raw = process.env.CRM_EXCLUDED_MAILBOXES_JSON,
): boolean {
	const normalizedMailbox = mailbox.trim().toLowerCase();
	return excludedMailboxesForUser(userId, raw).some(
		(row) => row.source === source && row.mailbox === normalizedMailbox,
	);
}

export function hasOwnedExcludedMailboxForSource(
	userId: string,
	source: string,
	raw = process.env.CRM_EXCLUDED_MAILBOXES_JSON,
): boolean {
	return excludedMailboxesForUser(userId, raw).some(
		(row) => row.source === source,
	);
}

export function historyCoverageForUser(
	userId: string,
	raw = process.env.CRM_EXCLUDED_MAILBOXES_JSON,
): "complete" | "limited" {
	return excludedMailboxesForUser(userId, raw).length > 0
		? "limited"
		: "complete";
}
