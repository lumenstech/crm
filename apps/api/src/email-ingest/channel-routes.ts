import { z } from "zod";

const channelRoutesSchema = z.object({
	email: z.record(z.string(), z.string()).default({}),
	whatsapp: z.record(z.string(), z.string()).default({}),
});

export type ChannelRoutes = z.infer<typeof channelRoutesSchema>;

export function parseChannelRoutes(raw?: string): ChannelRoutes {
	if (!raw?.trim()) return { email: {}, whatsapp: {} };
	return channelRoutesSchema.parse(JSON.parse(raw));
}

export function routeEmail(routes: ChannelRoutes, recipient: string): string | null {
	const normalized = recipient.trim().toLowerCase();
	return routes.email[normalized] ?? null;
}

export function routeWhatsapp(routes: ChannelRoutes, phoneNumberId: string): string | null {
	return routes.whatsapp[phoneNumberId] ?? null;
}
