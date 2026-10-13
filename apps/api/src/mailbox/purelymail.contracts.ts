import { z } from "zod";

export const purelymailCredentialStatusOutput = z.object({
	mailbox: z.string(),
	folder: z.string().nullable(),
	configured: z.boolean(),
	enabled: z.boolean(),
	serverKeyConfigured: z.boolean(),
	sync: z.object({
		status: z.string().nullable(),
		lastSyncedAt: z.string().nullable(),
		lastError: z.string().nullable(),
	}),
});

export const savePurelymailCredentialInput = z.object({
	password: z.string().min(1).max(500),
	folder: z
		.string()
		.trim()
		.min(1)
		.max(255)
		.refine(
			(value) =>
				[...value].every((character) => {
					const code = character.charCodeAt(0);
					return code >= 32 && code !== 127;
				}),
			"Use an IMAP folder path without control characters.",
		),
});

export type PurelymailCredentialStatus = z.infer<
	typeof purelymailCredentialStatusOutput
>;
