import { type Db, Prisma } from "@crm/db";
import {
	ConflictException,
	GoneException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import type {
	ExecutorAcceptInput,
	ExecutorCheckpointInput,
	ExecutorFailureInput,
	ExecutorResultEmailInput,
	ExecutorResultInput,
} from "./executor.types";

const LEASE_MS = 10 * 60_000;
const MAX_ATTEMPTS = 3;

@Injectable()
export class ExecutorService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async accept(input: ExecutorAcceptInput) {
		const existing = await this.db.executorJob.findUnique({
			where: { id: input.envelope.jobId },
		});

		if (existing) {
			if (
				existing.payloadHash !== input.envelope.payloadHash ||
				existing.sourceAccount !== input.source.account ||
				existing.sourceEmailId !== input.source.emailId
			) {
				throw new ConflictException(
					"The job id is already bound to a different payload or source.",
				);
			}
			return { job: existing, duplicate: true };
		}

		const source = await this.db.executorJob.findUnique({
			where: {
				sourceAccount_sourceEmailId: {
					sourceAccount: input.source.account,
					sourceEmailId: input.source.emailId,
				},
			},
		});
		if (source) {
			if (source.payloadHash !== input.envelope.payloadHash) {
				throw new ConflictException(
					"The source email is already bound to a different payload.",
				);
			}
			return { job: source, duplicate: true };
		}

		const expiresAt = new Date(input.envelope.expiresAt);
		const expired = expiresAt.getTime() <= Date.now();

		try {
			const job = await this.db.executorJob.create({
				data: {
					id: input.envelope.jobId,
					operation: input.envelope.operation,
					taskRef: input.envelope.taskRef,
					payloadHash: input.envelope.payloadHash,
					sourceAccount: input.source.account,
					sourceEmailId: input.source.emailId,
					sourceMessageId: input.source.messageId ?? null,
					sourceFrom: input.source.from ?? null,
					sourceSubject: input.source.subject ?? null,
					sourceTo: input.source.to,
					status: expired ? "EXPIRED" : "QUEUED",
					envelope: input.envelope,
					expiresAt,
					finishedAt: expired ? new Date() : null,
				},
			});
			if (expired) {
				throw new GoneException("The executor request has expired.");
			}
			return { job, duplicate: false };
		} catch (error) {
			if (
				!(error instanceof Prisma.PrismaClientKnownRequestError) ||
				error.code !== "P2002"
			) {
				throw error;
			}
			const duplicate = await this.db.executorJob.findFirst({
				where: {
					OR: [
						{ id: input.envelope.jobId },
						{
							sourceAccount: input.source.account,
							sourceEmailId: input.source.emailId,
						},
					],
				},
			});
			if (
				duplicate &&
				duplicate.payloadHash === input.envelope.payloadHash &&
				duplicate.sourceAccount === input.source.account &&
				duplicate.sourceEmailId === input.source.emailId
			) {
				return { job: duplicate, duplicate: true };
			}
			throw new ConflictException(
				"The executor job identity is already in use.",
			);
		}
	}

	async checkpoint(input: ExecutorCheckpointInput) {
		return this.db.executorCheckpoint.upsert({
			where: {
				provider_account: {
					provider: input.provider,
					account: input.account,
				},
			},
			create: {
				id: `${input.provider}:${input.account}`,
				provider: input.provider,
				account: input.account,
				cursor: input.cursor,
			},
			update: { cursor: input.cursor },
		});
	}

	async readCheckpoint(provider: "resend", account: string) {
		return this.db.executorCheckpoint.findUnique({
			where: { provider_account: { provider, account } },
		});
	}

	async claim() {
		const now = new Date();
		await this.db.executorJob.updateMany({
			where: {
				status: "RUNNING",
				leaseUntil: { lt: now },
				expiresAt: { gt: now },
				finishedAt: null,
			},
			data: { status: "QUEUED", leaseUntil: null },
		});
		await this.db.executorJob.updateMany({
			where: {
				status: { in: ["QUEUED", "RUNNING"] },
				expiresAt: { lte: now },
				finishedAt: null,
			},
			data: { status: "EXPIRED", leaseUntil: null, finishedAt: now },
		});

		const candidates = await this.db.executorJob.findMany({
			where: {
				status: "QUEUED",
				expiresAt: { gt: now },
				OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
			},
			orderBy: { createdAt: "asc" },
			take: 10,
		});

		for (const candidate of candidates) {
			const leaseUntil = new Date(Date.now() + LEASE_MS);
			const leased = await this.db.executorJob.updateMany({
				where: {
					id: candidate.id,
					status: "QUEUED",
					OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
				},
				data: {
					status: "RUNNING",
					leaseUntil,
					attempts: { increment: 1 },
					startedAt: candidate.startedAt ?? now,
				},
			});
			if (leased.count === 1) {
				return this.db.executorJob.findUniqueOrThrow({
					where: { id: candidate.id },
				});
			}
		}
		return null;
	}

	async recordResult(id: string, input: ExecutorResultInput) {
		const existing = await this.get(id);
		if (existing.status !== "RUNNING") {
			if (existing.status === "COMPLETED") {
				if (existing.queueHash !== input.queueHash) {
					throw new ConflictException(
						"The completed result has a different queue hash.",
					);
				}
				return existing;
			}
			throw new ConflictException("The executor job is not running.");
		}
		const updated = await this.db.executorJob.updateMany({
			where: { id, status: "RUNNING", leaseUntil: { gte: new Date() } },
			data: {
				status: "COMPLETED",
				queueHash: input.queueHash,
				result: input.result as Prisma.InputJsonValue,
				receipt: input.receipt as Prisma.InputJsonValue,
				leaseUntil: null,
				finishedAt: new Date(),
			},
		});
		if (updated.count === 0)
			throw new ConflictException("The executor lease expired.");
		return this.get(id);
	}

	async recordResultEmail(id: string, input: ExecutorResultEmailInput) {
		const job = await this.get(id);
		if (job.status !== "COMPLETED" && job.status !== "PARTIALLY_FAILED") {
			throw new ConflictException("The executor result is not complete.");
		}
		if (job.resultEmailId && job.resultEmailId !== input.resultEmailId) {
			throw new ConflictException(
				"The executor result email is already recorded.",
			);
		}
		return this.db.executorJob.update({
			where: { id },
			data: {
				resultEmailId: input.resultEmailId,
				errorCode: null,
				errorMessage: null,
			},
		});
	}

	async recordFailure(id: string, input: ExecutorFailureInput) {
		const job = await this.get(id);
		if (job.status !== "RUNNING") {
			if (job.status === "FAILED" || job.status === "EXPIRED") return job;
			throw new ConflictException("The executor job is not running.");
		}
		if (!job.leaseUntil || job.leaseUntil.getTime() <= Date.now()) {
			throw new ConflictException("The executor lease expired.");
		}
		const retry =
			job.attempts < MAX_ATTEMPTS && job.expiresAt.getTime() > Date.now();
		return this.db.executorJob.update({
			where: { id },
			data: {
				status: retry ? "QUEUED" : "FAILED",
				errorCode: input.code,
				errorMessage: input.message,
				leaseUntil: null,
				finishedAt: retry ? null : new Date(),
			},
		});
	}

	async markResultDeliveryFailure(id: string, input: ExecutorFailureInput) {
		const job = await this.get(id);
		if (job.status !== "COMPLETED") return job;
		return this.db.executorJob.update({
			where: { id },
			data: {
				status: "PARTIALLY_FAILED",
				errorCode: input.code,
				errorMessage: input.message,
			},
		});
	}

	async get(id: string) {
		const job = await this.db.executorJob.findUnique({ where: { id } });
		if (!job)
			throw new NotFoundException("No executor job exists with that id.");
		return job;
	}
}
