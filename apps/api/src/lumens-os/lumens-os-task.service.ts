import type { Db } from "@crm/db";
import { Inject, Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import type { GauzyAdapter } from "./gauzy.adapter";
import { GauzyPromotionService } from "./gauzy-promotion.service";
import { GAUZY_ADAPTER } from "./lumens-os.constants";

@Injectable()
export class LumensOsTaskService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly promotions: GauzyPromotionService,
		@Inject(GAUZY_ADAPTER) private readonly gauzy: GauzyAdapter | null,
	) {}

	async drain(limit = 10) {
		if (!this.gauzy) return { enabled: false, processed: 0 };
		const tasks = await this.db.agentTask.findMany({
			where: {
				kind: "gauzy_promotion",
				finishedAt: null,
				dueAt: { lte: new Date() },
				OR: [{ leasedUntil: null }, { leasedUntil: { lt: new Date() } }],
			},
			orderBy: [{ priority: "desc" }, { dueAt: "asc" }],
			take: limit,
			select: { id: true, subject: true },
		});
		let processed = 0;
		for (const task of tasks) {
			if (!task.subject) continue;
			const leasedUntil = new Date(Date.now() + 5 * 60_000);
			const claimed = await this.db.agentTask.updateMany({
				where: {
					id: task.id,
					finishedAt: null,
					OR: [{ leasedUntil: null }, { leasedUntil: { lt: new Date() } }],
				},
				data: { leasedUntil },
			});
			if (claimed.count !== 1) continue;
			try {
				await this.promotions.promote(task.subject, this.gauzy);
				processed += 1;
			} finally {
				await this.db.agentTask.updateMany({
					where: { id: task.id, finishedAt: null },
					data: { leasedUntil: null },
				});
			}
		}
		return { enabled: true, processed };
	}
}
