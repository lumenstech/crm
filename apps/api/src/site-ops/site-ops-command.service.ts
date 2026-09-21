import {
	canAcknowledgeSiteAlert,
	canCreateSiteTask,
	canViewSiteOperations,
	workspaceRoleOf,
} from "@crm/auth";
import type { Db } from "@crm/db";
import type {
	SiteAlertMetadata,
	SiteTaskCommandData,
} from "@crm/validation/site-operations";
import {
	acknowledgeCommandId,
	createTaskCommandId,
	parseSiteAlertMetadata,
} from "@crm/validation/site-operations";
import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	NotFoundException,
	UnprocessableEntityException,
} from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { emitOperationalEvent } from "../lumens-os/operational-events";
import type {
	AcknowledgeAlertInput,
	AcknowledgeAlertOutput,
	CreateTaskFromAlertInput,
	CreateTaskFromAlertOutput,
} from "./site-ops.contracts";
import { SiteOpsService } from "./site-ops.service";

@Injectable()
export class SiteOpsCommandService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly sites: SiteOpsService,
	) {}

	async assertCanView(userId: string): Promise<void> {
		if (!canViewSiteOperations(await workspaceRoleOf(userId))) {
			throw new ForbiddenException(
				"Site Operations requires workspace membership.",
			);
		}
	}

	async acknowledgeAlert(
		userId: string,
		input: AcknowledgeAlertInput,
		now = new Date(),
	): Promise<AcknowledgeAlertOutput> {
		if (!canAcknowledgeSiteAlert(await workspaceRoleOf(userId))) {
			throw new ForbiddenException(
				"Acknowledging a site alert requires workspace membership.",
			);
		}

		const alert = await this.db.siteOpsAlert.findUnique({
			where: { id: input.alertId },
			select: { id: true, state: true, metadata: true },
		});
		if (!alert) {
			throw new NotFoundException(`No alert with id ${input.alertId}.`);
		}
		if (input.commandId !== acknowledgeCommandId(alert.id)) {
			throw new BadRequestException(
				"commandId does not match this alert's acknowledge command.",
			);
		}
		if (alert.state === "closed") {
			throw new UnprocessableEntityException(
				"A closed alert cannot be acknowledged.",
			);
		}

		const changed = alert.state !== "acknowledged";
		if (changed) {
			const stored = parseSiteAlertMetadata(alert.metadata);
			const metadata: SiteAlertMetadata = input.note
				? { ...stored, acknowledgeNote: input.note }
				: stored;
			await this.db.siteOpsAlert.update({
				where: { id: alert.id },
				data: {
					state: "acknowledged",
					acknowledgedAt: now,
					acknowledgedBy: userId,
					metadata,
				},
			});
		}

		const [summary] = await this.sites.alertSummaries({
			where: { id: alert.id },
			now,
		});
		if (!summary) {
			throw new NotFoundException(`No alert with id ${input.alertId}.`);
		}
		return { alert: summary, changed };
	}

	/**
	 * The one write that leaves Site Operations. The client names the alert and the
	 * words on the ticket. Every identity - site, asset, business unit, provenance -
	 * is resolved here from the alert, because a client that picks its own business
	 * unit can write into any business unit.
	 *
	 * The alert must be acknowledged first. Detection is automatic; sending a person
	 * to a site is not, and a hidden button is not a gate.
	 */
	async createTaskFromAlert(
		userId: string,
		input: CreateTaskFromAlertInput,
	): Promise<CreateTaskFromAlertOutput> {
		if (!canCreateSiteTask(await workspaceRoleOf(userId))) {
			throw new ForbiddenException(
				"Creating a service task requires workspace owner or admin.",
			);
		}

		const alert = await this.db.siteOpsAlert.findUnique({
			where: { id: input.alertId },
			include: {
				site: { select: { id: true, businessUnitId: true } },
				asset: { select: { id: true, siteId: true } },
			},
		});
		if (!alert) {
			throw new NotFoundException(`No alert with id ${input.alertId}.`);
		}
		if (input.commandId !== createTaskCommandId(alert.id)) {
			throw new BadRequestException(
				"commandId does not match this alert's create-task command.",
			);
		}
		if (alert.asset.siteId !== alert.site.id) {
			throw new BadRequestException(
				"Alert asset and site do not agree. Refusing to dispatch.",
			);
		}
		if (alert.state === "closed") {
			throw new UnprocessableEntityException(
				"A closed alert cannot create a service task.",
			);
		}
		if (alert.state !== "acknowledged") {
			throw new UnprocessableEntityException(
				"Acknowledge this alert before creating a service task. A human reviews the alert first.",
			);
		}

		const data: SiteTaskCommandData = {
			siteId: alert.siteId,
			assetId: alert.assetId,
			alertId: alert.id,
			title: input.title,
			description: input.description,
			severity: alert.severity as SiteTaskCommandData["severity"],
			reason: alert.reason,
			observationId: alert.observationId,
			provider: alert.provider,
			metric: alert.metric,
			requestedBy: userId,
			origin: {
				provider: "lumens",
				surface: "lumens-site-operations",
			},
		};

		const result = await this.db.$transaction((tx) =>
			emitOperationalEvent(tx, {
				version: 1,
				eventType: "task.create",
				canonicalType: "alert",
				canonicalId: alert.id,
				businessUnitId: alert.site.businessUnitId,
				commandId: input.commandId,
				data,
			}),
		);

		if (!alert.lumensOsEventId) {
			await this.db.siteOpsAlert.update({
				where: { id: alert.id },
				data: { lumensOsEventId: result.eventId },
			});
		}

		const event = await this.db.lumensOsEvent.findUnique({
			where: { id: result.eventId },
			select: { status: true },
		});

		return {
			accepted: true,
			created: result.created,
			eventId: result.eventId,
			alertId: alert.id,
			status: event?.status ?? "pending",
		};
	}
}
