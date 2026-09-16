import { type EvabootClient, evabootEmail } from "./evaboot.ts";
import { EVABOOT } from "./evaboot-config.ts";
import {
	type EvabootPreviewRequest,
	type EvabootProspect,
	type EvabootQuota,
	evabootPreviewRequest,
	evabootProfilePlanRequest,
} from "./evaboot-contracts.ts";

function emailEvidence(prospect: EvabootProspect) {
	const rawStatus = prospect["Email Status"]?.trim() ?? "";
	const email = evabootEmail.safeParse(prospect.Email?.trim());
	if (!email.success) {
		return {
			address: null,
			providerStatus: rawStatus,
			assessment: "missing_or_invalid",
		};
	}
	const [local, domain] = email.data.toLowerCase().split("@");
	if (EVABOOT.personalDomains.some((value) => value === domain)) {
		return {
			address: null,
			providerStatus: rawStatus,
			assessment: "personal_domain_rejected",
		};
	}
	if (EVABOOT.sharedMailboxes.some((value) => value === local)) {
		return {
			address: null,
			providerStatus: rawStatus,
			assessment: "shared_mailbox_rejected",
		};
	}
	const assessment =
		rawStatus.toLowerCase() === "safe"
			? "provider_safe_employer_unchecked"
			: "not_verified";
	return { address: email.data, providerStatus: rawStatus, assessment };
}

function candidate(
	prospect: EvabootProspect,
	extractionId: string,
	row: number,
	observedAt: string,
) {
	return {
		sourceSystem: "evaboot",
		underlyingSource: "linkedin_sales_navigator",
		sourceRecordId: `${extractionId}:${row}`,
		extractionId,
		row,
		observedAt,
		fullName: prospect["Full Name"]?.trim() ?? "",
		titleRaw: prospect["Current Job"]?.trim() ?? "",
		companyName: prospect["Company Name"]?.trim() ?? "",
		email: emailEvidence(prospect),
		promotion: "review_required",
		reviewReasons: [
			"identity_and_current_employer_unchecked",
			"work_email_ownership_unchecked",
			"verification_timestamp_unavailable",
			"product_and_business_unit_unassigned",
			"suppression_unchecked",
		],
	};
}

export async function previewEvabootExtraction(
	client: EvabootClient,
	input: EvabootPreviewRequest,
) {
	const parsed = evabootPreviewRequest.safeParse(input);
	if (!parsed.success) return { ok: false, code: "invalid_input" } as const;
	const { extractionId, maxRecords } = parsed.data;
	const observedAt = new Date().toISOString();
	const candidates: ReturnType<typeof candidate>[] = [];
	let start = parsed.data.start;
	let totalCount: number | null = null;
	let hasMore = true;
	while (hasMore && candidates.length < maxRecords) {
		const result = await client.extraction({
			extractionId,
			start,
			limit: Math.min(EVABOOT.pageSize, maxRecords - candidates.length),
		});
		if (!result.ok) return result;
		if (result.value.state !== "complete") {
			return { ok: false, code: `extraction_${result.value.state}` } as const;
		}
		const { page } = result.value;
		if (totalCount !== null && totalCount !== page.total_count) {
			return { ok: false, code: "results_changed" } as const;
		}
		totalCount = page.total_count;
		candidates.push(
			...page.prospects.map((prospect, index) =>
				candidate(prospect, extractionId, start + index, observedAt),
			),
		);
		start += page.returned_count;
		hasMore = page.has_more;
	}
	return {
		ok: true,
		value: {
			schemaVersion: 1,
			extractionId,
			observedAt,
			start: parsed.data.start,
			totalCount,
			returnedCount: candidates.length,
			hasMore,
			nextStart: hasMore ? start : null,
			crmWrites: 0,
			candidates,
		},
	} as const;
}

export function planEvabootProfiles(
	quota: EvabootQuota,
	profiles: number,
	maxCredits: number,
) {
	const parsed = evabootProfilePlanRequest.safeParse({ profiles, maxCredits });
	if (!parsed.success) return { ok: false, code: "invalid_input" } as const;
	const reservedCredits =
		profiles * (EVABOOT.exportCredits + EVABOOT.emailCredits);
	const largestAccountRemaining = Math.max(
		0,
		...quota.salesnavs
			.filter((account) => account.status === "valid")
			.map((account) => account.remaining),
	);
	const reasons = [];
	if (!quota.has_valid_salesnav) reasons.push("sales_navigator_not_connected");
	if (profiles > largestAccountRemaining)
		reasons.push("single_account_quota_exceeded");
	if (reservedCredits > quota.credits)
		reasons.push("insufficient_provider_credits");
	if (reservedCredits > maxCredits) reasons.push("credit_cap_exceeded");
	return {
		ok: true,
		value: {
			profiles,
			reservedCredits,
			largestAccountRemaining,
			fitsSnapshot: reasons.length === 0,
			reasons,
			creditsReserved: false,
			jobSubmitted: false,
		},
	} as const;
}
