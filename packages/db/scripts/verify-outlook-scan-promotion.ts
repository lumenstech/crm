import { db } from "../src/index";

async function main() {
	const scanId = "outlook:danny@lumenstechnology.com:0-4799";

	const [
		archive,
		sourceByUnit,
		companyByUnit,
		contactByUnit,
		dataGearUnits,
		sourceCount,
	] = await Promise.all([
		db.$queryRaw<Array<{
			scan_id: string;
			messages_scanned: number;
			next_scan_index: number;
			finding_count: number;
			payload_hash: string;
		}>>`
			SELECT
				scan_id,
				messages_scanned,
				next_scan_index,
				jsonb_array_length(payload->'findings')::int AS finding_count,
				payload_hash
			FROM outlook_scan_archive
			WHERE scan_id = ${scanId}
		`,
		db.$queryRaw<Array<{
			key: string;
			name: string;
			count: bigint;
		}>>`
			SELECT bu.key, bu.name, COUNT(*)::bigint AS count
			FROM source_record sr
			JOIN business_unit bu ON bu.id = sr."businessUnitId"
			WHERE sr."sourceSystem" = 'outlook-scan'
			  AND sr."sourceType" = 'finding'
			  AND sr."sourceId" LIKE ${scanId + ":%"}
			GROUP BY bu.key, bu.name
			ORDER BY bu.key
		`,
		db.$queryRaw<Array<{
			key: string;
			name: string;
			count: bigint;
		}>>`
			SELECT bu.key, bu.name, COUNT(*)::bigint AS count
			FROM company c
			JOIN business_unit bu ON bu.id = c."businessUnitId"
			WHERE c.source = CAST('IMPORT' AS "RecordSource")
			  AND c.id LIKE 'outlook-company-%'
			GROUP BY bu.key, bu.name
			ORDER BY bu.key
		`,
		db.$queryRaw<Array<{
			key: string;
			name: string;
			count: bigint;
		}>>`
			SELECT bu.key, bu.name, COUNT(*)::bigint AS count
			FROM contact ct
			JOIN company c ON c.id = ct."companyId"
			JOIN business_unit bu ON bu.id = c."businessUnitId"
			WHERE ct.source = CAST('IMPORT' AS "RecordSource")
			  AND ct.id LIKE 'outlook-contact-%'
			GROUP BY bu.key, bu.name
			ORDER BY bu.key
		`,
		db.$queryRaw<Array<{
			id: string;
			key: string;
			name: string;
			company_count: bigint;
			deal_count: bigint;
			source_count: bigint;
		}>>`
			SELECT
				bu.id,
				bu.key,
				bu.name,
				COUNT(DISTINCT c.id)::bigint AS company_count,
				COUNT(DISTINCT d.id)::bigint AS deal_count,
				COUNT(DISTINCT sr.id)::bigint AS source_count
			FROM business_unit bu
			LEFT JOIN company c ON c."businessUnitId" = bu.id AND c."archivedAt" IS NULL
			LEFT JOIN deal d ON d."businessUnitId" = bu.id AND d."archivedAt" IS NULL
			LEFT JOIN source_record sr ON sr."businessUnitId" = bu.id
			WHERE bu.key IN ('data-gear', 'datagear')
			GROUP BY bu.id, bu.key, bu.name
			ORDER BY bu.key
		`,
		db.$queryRaw<Array<{ count: bigint }>>`
			SELECT COUNT(*)::bigint AS count
			FROM source_record
			WHERE "sourceSystem" = 'outlook-scan'
			  AND "sourceType" = 'finding'
			  AND "sourceId" LIKE ${scanId + ":%"}
		`,
	]);

	const json = (value: unknown) =>
		JSON.stringify(
			value,
			(_key, item) => (typeof item === "bigint" ? Number(item) : item),
			2,
		);

	console.log(
		json({
			archive: archive[0] ?? null,
			totalPromotedFindings: Number(sourceCount[0]?.count ?? 0),
			sourceRecordsByBusinessUnit: sourceByUnit,
			importedCompaniesByBusinessUnit: companyByUnit,
			importedContactsByBusinessUnit: contactByUnit,
			dataGearDuplicateAudit: dataGearUnits,
		}),
	);
}

main()
	.catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	})
	.finally(async () => {
		await db.$disconnect();
	});
