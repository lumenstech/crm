import type { Db } from "@crm/db";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

@Injectable()
export class BusinessUnitsService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async list() {
		return this.db.businessUnit.findMany({
			where: { enabled: true },
			select: {
				id: true,
				key: true,
				name: true,
				description: true,
				enabled: true,
			},
			orderBy: { name: "asc" },
		});
	}
}
