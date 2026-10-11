import { normaliseMessageId } from "./message-text";

const IMAP_PREFIX = "purelymail-imap:";
const RFC_PREFIX = "purelymail-rfc:";

export type PurelymailProviderMessageIdentity =
	| {
			kind: "imap";
			mailbox: string;
			folder: string;
			uidValidity: string;
			uid: number;
	  }
	| { kind: "rfc"; rfcMessageId: string };

export function purelymailImapMessageId(input: {
	mailbox: string;
	folder: string;
	uidValidity: string;
	uid: number;
}): string {
	return [
		IMAP_PREFIX.slice(0, -1),
		encodeURIComponent(input.mailbox.trim().toLowerCase()),
		encodeURIComponent(input.folder.trim()),
		input.uidValidity.trim(),
		String(input.uid),
	].join(":");
}

export function purelymailRfcMessageId(rfcMessageId: string): string {
	return `${RFC_PREFIX}${normaliseMessageId(rfcMessageId)}`;
}

export function purelymailProviderThreadId(rootMessageId: string): string {
	return purelymailRfcMessageId(rootMessageId);
}

export function parsePurelymailProviderMessageId(
	value: string,
): PurelymailProviderMessageIdentity | null {
	if (value.startsWith(RFC_PREFIX)) {
		const rfcMessageId = value.slice(RFC_PREFIX.length).trim();
		return rfcMessageId ? { kind: "rfc", rfcMessageId } : null;
	}

	const parts = value.split(":");
	if (parts.length !== 5 || parts[0] !== "purelymail-imap") return null;
	const [, encodedMailbox, encodedFolder, uidValidity, rawUid] = parts;
	const parsedUidValidity = uidValidity ?? "";
	const parsedUid = rawUid ?? "";
	if (
		!encodedMailbox ||
		!encodedFolder ||
		!/^[0-9]+$/.test(parsedUidValidity) ||
		!/^[1-9][0-9]*$/.test(parsedUid)
	) {
		return null;
	}

	try {
		const mailbox = decodeURIComponent(encodedMailbox).toLowerCase();
		const folder = decodeURIComponent(encodedFolder);
		if (!mailbox || !folder) return null;
		return {
			kind: "imap",
			mailbox,
			folder,
			uidValidity: parsedUidValidity,
			uid: Number(parsedUid),
		};
	} catch {
		return null;
	}
}

export function isPurelymailProviderMessageId(
	value: string,
	input: { mailbox: string; rfcMessageId: string },
): boolean {
	const identity = parsePurelymailProviderMessageId(value);
	if (!identity) return false;
	if (identity.kind === "imap") {
		return identity.mailbox === input.mailbox.trim().toLowerCase();
	}
	return identity.rfcMessageId === normaliseMessageId(input.rfcMessageId);
}

export function isPurelymailProviderThreadId(
	value: string,
	rootMessageId: string,
): boolean {
	return value === purelymailProviderThreadId(rootMessageId);
}
