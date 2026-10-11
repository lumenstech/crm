export const PURELYMAIL_IMAP = {
	host: "imap.purelymail.com",
	port: 993,
	secure: true,
	mailbox: "sales@data-gear.com",
	source: "purelymail" as const,
	maxMessagesPerTick: 50,
	maxMessageBytes: 512_000,
	pollIntervalMs: 60_000,
	connectionTimeoutMs: 10_000,
	greetingTimeoutMs: 10_000,
	socketTimeoutMs: 30_000,
} as const;
