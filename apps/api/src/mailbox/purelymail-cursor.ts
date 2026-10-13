import { z } from "zod";

export type PurelymailCursor = {
	folder: string;
	uidValidity: string;
	uid: number;
};

export function parseCursor(value: string | null): PurelymailCursor | null {
	if (!value) return null;
	try {
		const parsed = z
			.object({
				folder: z.string().min(1),
				uidValidity: z.string().min(1),
				uid: z.number().int().nonnegative(),
			})
			.strict()
			.safeParse(JSON.parse(value));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

export function selectPurelymailUids(
	uids: readonly number[],
	cursor: PurelymailCursor | null,
	folder: string,
	uidValidity: string,
	limit: number,
): { uids: number[]; nextCursor: PurelymailCursor } {
	const matchingCursor =
		cursor?.folder === folder && cursor.uidValidity === uidValidity
			? cursor
			: null;
	const pageUids = uids
		.filter((uid) => matchingCursor === null || uid > matchingCursor.uid)
		.sort((left, right) => left - right)
		.slice(0, limit);

	return {
		uids: pageUids,
		nextCursor: {
			folder,
			uidValidity,
			uid: pageUids.at(-1) ?? matchingCursor?.uid ?? 0,
		},
	};
}
