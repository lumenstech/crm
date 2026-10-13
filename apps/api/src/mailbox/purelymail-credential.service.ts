import { type Db, GoogleSyncStatus } from "@crm/db";
import {
	BadRequestException,
	ForbiddenException,
	Injectable,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentVariables } from "../config/env.validation";
import { InjectDatabase } from "../database/database.constants";
import {
	decryptPurelymailPassword,
	encryptPurelymailPassword,
	parsePurelymailCredentialKey,
	sanitizePurelymailError,
} from "./purelymail-credential.crypto";
import { PURELYMAIL_IMAP } from "./purelymail-imap.config";

export type PurelymailCredentialStatus = {
	mailbox: string;
	folder: string | null;
	configured: boolean;
	enabled: boolean;
	serverKeyConfigured: boolean;
	sync: {
		status: string | null;
		lastSyncedAt: string | null;
		lastError: string | null;
	};
};

export type ActivePurelymailCredential = {
	userId: string;
	password: string;
	folder: string;
	updatedAt: Date;
};

@Injectable()
export class PurelymailCredentialService {
	private readonly key: Buffer | null;

	constructor(
		config: ConfigService<EnvironmentVariables, true>,
		@InjectDatabase() private readonly db: Db,
	) {
		this.key = parsePurelymailCredentialKey(
			config.get("PURELYMAIL_CREDENTIAL_KEY", { infer: true }),
		);
	}

	status(userId: string): Promise<PurelymailCredentialStatus> {
		this.assertOwner(userId);
		return this.readStatus();
	}

	async save(
		userId: string,
		password: string,
		folder: string,
	): Promise<PurelymailCredentialStatus> {
		this.assertOwner(userId);
		const key = this.requireKey();
		const normalizedPassword = password;
		const normalizedFolder = folder.trim();
		if (!normalizedPassword.trim()) {
			throw new BadRequestException("Enter the Purelymail password.");
		}
		if (!normalizedFolder) {
			throw new BadRequestException("Enter the read-only Sent folder.");
		}

		const encrypted = encryptPurelymailPassword(normalizedPassword, key);
		await this.db.purelymailCredential.upsert({
			where: { userId },
			create: {
				userId,
				encryptedPassword: encrypted.ciphertext,
				nonce: encrypted.nonce,
				authTag: encrypted.authTag,
				keyVersion: encrypted.keyVersion,
				folder: normalizedFolder,
				enabled: false,
			},
			update: {
				encryptedPassword: encrypted.ciphertext,
				nonce: encrypted.nonce,
				authTag: encrypted.authTag,
				keyVersion: encrypted.keyVersion,
				folder: normalizedFolder,
				enabled: false,
			},
		});
		await this.disableSync(userId);
		return this.readStatus();
	}

	async enable(userId: string): Promise<PurelymailCredentialStatus> {
		this.assertOwner(userId);
		const key = this.requireKey();
		const credential = await this.db.purelymailCredential.findUnique({
			where: { userId },
		});
		if (!credential) {
			throw new BadRequestException("Save a Purelymail credential first.");
		}

		try {
			decryptPurelymailPassword(
				{
					ciphertext: credential.encryptedPassword,
					nonce: credential.nonce,
					authTag: credential.authTag,
					keyVersion: credential.keyVersion,
				},
				key,
			);
		} catch (error) {
			throw new BadRequestException(
				sanitizePurelymailError(
					error instanceof Error ? error : "Purelymail credential invalid.",
				),
			);
		}

		await this.db.purelymailCredential.update({
			where: { userId },
			data: { enabled: true },
		});
		await this.db.mailboxSync.upsert({
			where: { userId_source: { userId, source: PURELYMAIL_IMAP.source } },
			create: { userId, source: PURELYMAIL_IMAP.source },
			update: {},
		});
		await this.normalizeIdleSync(userId);
		return this.readStatus();
	}

	async pause(userId: string): Promise<PurelymailCredentialStatus> {
		this.assertOwner(userId);
		await this.db.purelymailCredential.updateMany({
			where: { userId },
			data: { enabled: false },
		});
		await this.disableSync(userId);
		return this.readStatus();
	}

	async remove(userId: string): Promise<PurelymailCredentialStatus> {
		this.assertOwner(userId);
		await this.db.purelymailCredential.deleteMany({ where: { userId } });
		await this.disableSync(userId);
		return this.readStatus();
	}

	async active(): Promise<ActivePurelymailCredential | null> {
		if (!this.key) return null;
		const credential = await this.db.purelymailCredential.findFirst({
			where: { userId: PURELYMAIL_IMAP.ownerUserId, enabled: true },
		});
		if (!credential) return null;

		try {
			return {
				userId: credential.userId,
				password: decryptPurelymailPassword(
					{
						ciphertext: credential.encryptedPassword,
						nonce: credential.nonce,
						authTag: credential.authTag,
						keyVersion: credential.keyVersion,
					},
					this.key,
				),
				folder: credential.folder,
				updatedAt: credential.updatedAt,
			};
		} catch {
			return null;
		}
	}

	async isCurrent(credential: ActivePurelymailCredential): Promise<boolean> {
		const current = await this.db.purelymailCredential.findUnique({
			where: { userId: credential.userId },
			select: { enabled: true, folder: true, updatedAt: true },
		});

		return Boolean(
			current?.enabled &&
				current.folder === credential.folder &&
				current.updatedAt.getTime() === credential.updatedAt.getTime(),
		);
	}

	private async readStatus(): Promise<PurelymailCredentialStatus> {
		const [credential, sync] = await Promise.all([
			this.db.purelymailCredential.findUnique({
				where: { userId: PURELYMAIL_IMAP.ownerUserId },
				select: { folder: true, enabled: true },
			}),
			this.db.mailboxSync.findUnique({
				where: {
					userId_source: {
						userId: PURELYMAIL_IMAP.ownerUserId,
						source: PURELYMAIL_IMAP.source,
					},
				},
				select: { status: true, lastSyncedAt: true, lastError: true },
			}),
		]);
		return {
			mailbox: PURELYMAIL_IMAP.mailbox,
			folder: credential?.folder ?? null,
			configured: credential !== null,
			enabled: credential?.enabled ?? false,
			serverKeyConfigured: this.key !== null,
			sync: {
				status: sync?.status ?? null,
				lastSyncedAt: sync?.lastSyncedAt?.toISOString() ?? null,
				lastError: sync?.lastError
					? sanitizePurelymailError(sync.lastError)
					: null,
			},
		};
	}

	private async disableSync(userId: string): Promise<void> {
		await this.normalizeIdleSync(userId);
	}

	private async normalizeIdleSync(userId: string): Promise<void> {
		await this.db.mailboxSync.updateMany({
			where: {
				userId,
				source: PURELYMAIL_IMAP.source,
				status: { not: GoogleSyncStatus.RUNNING },
			},
			data: {
				status: GoogleSyncStatus.IDLE,
				lastError: null,
				retryAfter: null,
			},
		});
	}

	private requireKey(): Buffer {
		if (!this.key) {
			throw new BadRequestException(
				"Purelymail is not configured on this server yet.",
			);
		}
		return this.key;
	}

	private assertOwner(userId: string): void {
		if (userId !== PURELYMAIL_IMAP.ownerUserId) {
			throw new ForbiddenException();
		}
	}
}
