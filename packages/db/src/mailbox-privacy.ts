import type { Prisma } from "./generated/prisma/client";

export type ExcludedMailbox = {
	userId: string;
	source: "gmail" | "outlook" | "purelymail";
	mailbox: string;
};

export const EXCLUDED_MAILBOX: ExcludedMailbox = {
	userId: "CQILDYRIiaRmf7CD28VLn8jYPu6gSeTE",
	source: "gmail",
	mailbox: "danny@lumensny.com",
};

export function visibleEmailThreadWhere(
	excluded: readonly ExcludedMailbox[],
): Prisma.EmailThreadWhereInput {
	if (excluded.length === 0) return {};

	return {
		AND: [
			{ provider: { not: null } },
			{ mailbox: { not: null } },
			{
				NOT: {
					OR: excluded.map((row) => ({
						provider: row.source,
						mailbox: { equals: row.mailbox, mode: "insensitive" },
					})),
				},
			},
		],
	};
}

export function visibleActivityWhere(
	excluded: readonly ExcludedMailbox[],
): Prisma.ActivityWhereInput {
	if (excluded.length === 0) return {};

	return {
		OR: [
			{ emailThread: { is: null } },
			{
				emailThread: {
					is: { ...visibleEmailThreadWhere(excluded) },
				},
			},
		],
	};
}

export const protectedMailboxThreadWhere = visibleEmailThreadWhere([
	EXCLUDED_MAILBOX,
]);
