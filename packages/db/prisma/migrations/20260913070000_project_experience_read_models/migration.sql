CREATE OR REPLACE VIEW project_experience_index AS
SELECT
  sr.id AS source_record_id,
  sr."sourceId" AS project_id,
  sr."businessUnitId" AS business_unit_id,
  sr."companyId" AS company_id,
  cc.name AS canonical_company_name,
  sr.payload->>'canonical_name' AS project_name,
  sr.payload->>'client' AS client_label,
  sr.payload->>'site_name' AS site_name,
  sr.payload#>>'{location,city}' AS city,
  sr.payload#>>'{location,state}' AS state,
  sr.payload#>>'{dates,start}' AS start_date,
  sr.payload#>>'{dates,end}' AS end_date,
  sr.payload->>'sector' AS sector,
  sr.payload->>'project_type' AS project_type,
  sr.payload->>'scope_summary' AS scope_summary,
  sr.payload->>'systems' AS systems,
  sr.payload->>'delivery_partner' AS delivery_partner,
  sr.payload->>'completion_status' AS completion_status,
  sr.payload->>'claim_tier' AS claim_tier,
  sr.payload->>'evidence_strength' AS evidence_strength,
  NULLIF(sr.payload->>'amount_usd','')::numeric AS amount_usd,
  sr.payload->>'amount_basis' AS amount_basis,
  sr.payload->>'portfolio_language' AS portfolio_language,
  sr.payload->>'commercial_notes' AS commercial_notes,
  sr.payload->>'caveats' AS caveats,
  COALESCE(jsonb_array_length(sr.payload->'evidence'),0) AS evidence_items,
  COALESCE(sr.payload->'tags','[]'::jsonb) AS tags,
  CASE
    WHEN sr.payload->>'claim_tier' IN ('headline','supporting')
     AND sr.payload->>'completion_status' IN ('completed','invoiced','paid')
    THEN true ELSE false
	END AS sales_eligible,
	sr."observedAt" AS last_verified_at,
	sr."sourceUrl" AS source_url
FROM source_record sr
LEFT JOIN canonical_company cc ON cc.id = sr."companyId"
WHERE sr."sourceSystem" = 'lumens_project_knowledge'
  AND sr."sourceType" IN ('historical_project_experience','historical_project_review');

CREATE OR REPLACE VIEW project_experience_review_queue AS
SELECT *
FROM project_experience_index
WHERE NOT sales_eligible
   OR evidence_strength IN ('low','medium');

CREATE OR REPLACE VIEW project_experience_duplicate_candidates AS
SELECT * FROM (VALUES
  ('FEDEX-160105523','granite-fedex-melville-invoice-839','same Granite ticket/site; incomplete dispatch evidence','exact'),
  ('HOMEGOODS-0713-2022','granite-homegoods-0713-valley-stream-invoice-872','same store, location and Granite invoice','exact'),
  ('JOURNEYS-080336','journeys-080336-382353-01','same store and PO trail; scopes need reconciliation','high'),
  ('UBS-LED-2019-20','ubs-garden-city-27699-99994-618403','program summary overlaps Garden City work order','high'),
  ('UBS-LED-2019-20','ubs-garden-city-30872-99988-694341','program summary overlaps Garden City follow-on','high'),
  ('UBS-LED-2019-20','ubs-jericho-usai-30872-99990-651165','program summary overlaps Jericho work order','high'),
  ('WM-2156','walmart-2156-middle-island-telaid','same store and fire-alarm remediation','exact')
) AS d(project_id, prior_source_id, match_reason, confidence);

CREATE TABLE IF NOT EXISTS opportunity_project_match (
  id text PRIMARY KEY,
  "dealId" text NOT NULL REFERENCES deal(id) ON DELETE CASCADE,
	"sourceRecordId" text NOT NULL REFERENCES source_record(id) ON DELETE CASCADE,
  score integer NOT NULL CHECK (score >= 0 AND score <= 100),
  "matchedSignals" jsonb NOT NULL DEFAULT '[]'::jsonb,
  rationale text NOT NULL,
  "computedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("dealId", "sourceRecordId")
);

CREATE INDEX IF NOT EXISTS opportunity_project_match_deal_score_idx
ON opportunity_project_match ("dealId", score DESC);
