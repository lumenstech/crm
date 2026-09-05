import { type Db, type Prisma } from "@crm/db";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { PromotionService } from "./promotion.service";

@Injectable()
export class ResolutionService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly promotion: PromotionService,
	) {}

	process(sourceRecordId: string, actorId?: string) {
		return this.promotion.process(sourceRecordId, actorId);
	}

	async batch(limit: number, cursor?: string, actorId?: string) {
		const options: Prisma.SourceRecordFindManyArgs = {
			where: { status: { in: ["accepted", "failed"] } },
			orderBy: { id: "asc" },
			take: limit + 1,
			select: { id: true },
		};
		if (cursor) {
			options.cursor = { id: cursor };
			options.skip = 1;
		}
		const rows = await this.db.sourceRecord.findMany(options);
		const next = rows.length > limit ? rows.pop()?.id : undefined;
		const results = [];
		for (const row of rows)
			results.push({
				sourceRecordId: row.id,
				...(await this.promotion.process(row.id, actorId)),
			});
		return next ? { results, nextCursor: next } : { results };
	}

	async listReviews(input: {
		status?: string;
		businessUnitId?: string;
		limit: number;
	}) {
		const where: Prisma.ResolutionReviewWhereInput = {};
		if (input.status) where.status = input.status;
		if (input.businessUnitId)
			where.sourceRecord = { businessUnitId: input.businessUnitId };
		return this.db.resolutionReview.findMany({
			where,
			include: {
				candidates: {
					orderBy: { position: "asc" },
					select: { canonicalType: true, canonicalId: true, score: true },
				},
			},
			orderBy: { createdAt: "asc" },
			take: input.limit,
		});
	}

	getReview(reviewId: string) {
		return this.db.resolutionReview.findUnique({
			where: { id: reviewId },
			include: {
				candidates: {
					orderBy: { position: "asc" },
					select: { canonicalType: true, canonicalId: true, score: true },
				},
			},
		});
	}

	async decide(
		input: {
			reviewId: string;
			decision: string;
			canonicalId?: string;
			ownerId?: string;
			reason: string;
		},
		actorId: string,
	) {
		return this.db.$transaction(async (tx) => {
			const review = await tx.resolutionReview.findUnique({
				where: { id: input.reviewId },
				include: { sourceRecord: true },
			});
			if (!review) throw new Error("Review case was not found.");
			if (review.status !== "pending")
				throw new Error("Review case is no longer actionable.");
			if (input.decision === "approved_match" && !input.canonicalId)
				throw new Error("A canonical target is required.");
			if (
				input.ownerId &&
				!(await tx.user.findUnique({
					where: { id: input.ownerId },
					select: { id: true },
				}))
			)
				throw new Error("Invalid owner.");
			const status =
				input.decision === "rejected"
					? "rejected"
					: input.decision === "ignored"
						? "ignored"
						: "resolved";
			const promotion =
				status === "resolved"
					? await this.promotion.approveInTransaction(
							tx,
							review.sourceRecordId,
							review.entityType,
							input.canonicalId,
							input.ownerId,
						)
					: undefined;
			const updated = await tx.resolutionReview.update({
				where: { id: review.id },
				data: {
					status,
					decision: input.decision,
					decisionReason: input.reason,
					reviewerId: actorId,
					decisionAt: new Date(),
					resultCanonicalId: promotion?.canonicalId ?? input.canonicalId,
					resultVisibleId: promotion?.visibleId,
				},
			});
			await tx.sourceRecord.update({
				where: { id: review.sourceRecordId },
				data: {
					status: status === "resolved" ? "promoted" : status,
					error: null,
				},
			});
			await tx.promotionAudit.create({
				data: {
					sourceRecordId: review.sourceRecordId,
					businessUnitId: review.sourceRecord.businessUnitId,
					action: "review_decision",
					outcome: status,
					canonicalType: review.entityType,
					canonicalId: promotion?.canonicalId ?? input.canonicalId,
					visibleId: promotion?.visibleId,
					actorId,
					error: input.reason,
				},
			});
			return {
				id: updated.id,
				status: updated.status,
				sourceRecordId: updated.sourceRecordId,
				canonicalId: updated.resultCanonicalId ?? undefined,
			};
		});
	}
}
