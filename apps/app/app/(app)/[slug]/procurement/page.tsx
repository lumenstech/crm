import { db } from "@crm/db";
import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { Input } from "@crm/ui/components/input";
import { Textarea } from "@crm/ui/components/textarea";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import {
	PageShell,
	PageShellContent,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellTitle,
} from "@/components/page-shell";
import { ensureDataGearBusinessUnit } from "@/lib/procurement";
import { requireSession } from "@/lib/session";
import {
	addSupplierQuote,
	createCustomerRequest,
	createProduct,
	createSupplier,
} from "./actions";

export const metadata: Metadata = { title: "Procurement" };

type MatrixRow = {
	businessUnitId: string | null;
	supplierQuoteId: string;
	productId: string | null;
	category: string | null;
	manufacturer: string | null;
	productName: string | null;
	model: string | null;
	manufacturerSku: string | null;
	supplierName: string;
	unitCost: unknown;
	landedCost: unknown;
	targetSellPrice: unknown;
	grossProfitPerUnit: unknown;
	grossMarginPct: unknown;
	availableQty: unknown;
	leadTimeDays: number | null;
	pricingStatus: string;
	availabilityCheckedAt: Date | null;
	sourceRef: string | null;
	notes: string | null;
};

type DemandRow = {
	businessUnitId: string | null;
	productId: string | null;
	productType: string;
	manufacturer: string | null;
	model: string | null;
	manufacturerSku: string | null;
	gpuModel: string | null;
	openQuantity: unknown;
	openRequests: bigint;
	earliestRequiredBy: Date | null;
	statedTargetValue: unknown;
};

const n = (value: unknown) => (value == null ? null : Number(value));

const usd = (value: unknown) =>
	value == null
		? "—"
		: new Intl.NumberFormat("en-US", {
				style: "currency",
				currency: "USD",
				maximumFractionDigits: 2,
			}).format(Number(value));

const productLabel = (row: {
	manufacturer: string | null;
	productName?: string | null;
	model: string | null;
	gpuModel?: string | null;
	productType?: string;
}) =>
	[row.manufacturer, row.productName, row.model, row.gpuModel, row.productType]
		.filter(Boolean)
		.join(" ");

const demandKey = (row: DemandRow) =>
	[
		row.productId,
		row.productType,
		row.manufacturer,
		row.model,
		row.manufacturerSku,
		row.gpuModel,
	]
		.map((part) => part ?? "")
		.join("|");

export default function ProcurementPage({
	params,
}: PageProps<"/[slug]/procurement">) {
	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Procurement</PageShellTitle>
					<PageShellDescription>
						Supplier pricing, GPU/server demand, availability and buy/sell
						decisions.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>

			<PageShellContent>
				<Suspense
					fallback={
						<div className="py-12 text-sm text-muted-foreground">
							Loading procurement…
						</div>
					}
				>
					<ProcurementContent params={params} />
				</Suspense>
			</PageShellContent>
		</PageShell>
	);
}

async function ProcurementContent({
	params,
}: Pick<PageProps<"/[slug]/procurement">, "params">) {
	await connection();
	await requireSession();
	const { slug } = await params;
	const businessUnit = await ensureDataGearBusinessUnit();

	const [suppliers, products, requests, matrix, demand] = await Promise.all([
		db.procurementSupplier.findMany({
			where: { businessUnitId: businessUnit.id, active: true },
			orderBy: { supplierName: "asc" },
		}),
		db.procurementProduct.findMany({
			where: { businessUnitId: businessUnit.id, active: true },
			orderBy: [{ manufacturer: "asc" }, { productName: "asc" }],
		}),
		db.procurementCustomerRequest.findMany({
			where: { businessUnitId: businessUnit.id },
			orderBy: { requestedAt: "desc" },
			take: 20,
			include: { items: { take: 3 } },
		}),
		db.$queryRaw<MatrixRow[]>`
			SELECT *
			FROM "procurementSupplierBuySellMatrix"
			WHERE "businessUnitId" = ${businessUnit.id}
			ORDER BY "pricingStatus", "targetSellPrice" ASC NULLS LAST
			LIMIT 100
		`,
		db.$queryRaw<DemandRow[]>`
			SELECT *
			FROM "procurementCustomerDemandSummary"
			WHERE "businessUnitId" = ${businessUnit.id}
			ORDER BY "openRequests" DESC, "openQuantity" DESC
			LIMIT 100
		`,
	]);

	return (
		<div className="space-y-4">
			<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
				<Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">Open customer requests</div><div className="mt-1 text-3xl font-semibold">{requests.length}</div><div className="mt-1 text-xs text-muted-foreground">Demand currently being sourced</div></CardContent></Card>
				<Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">Priced supplier options</div><div className="mt-1 text-3xl font-semibold">{matrix.length}</div><div className="mt-1 text-xs text-muted-foreground">{suppliers.length} active suppliers</div></CardContent></Card>
				<Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">RFQ / stale pricing</div><div className="mt-1 text-3xl font-semibold">{matrix.filter((row) => row.pricingStatus !== "LIVE").length}</div><div className="mt-1 text-xs text-muted-foreground">Needs supplier confirmation</div></CardContent></Card>
				<Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">Potential GP / unit</div><div className="mt-1 text-2xl font-semibold">{usd(matrix.reduce((sum, row) => sum + (n(row.grossProfitPerUnit) ?? 0), 0))}</div><div className="mt-1 text-xs text-muted-foreground">Across currently priced options</div></CardContent></Card>
			</div>

			<div className="grid gap-4 xl:grid-cols-[1.1fr_1.4fr]">
				<Card>
					<CardHeader><CardTitle>Priority opportunities</CardTitle></CardHeader>
					<CardContent className="space-y-3">
						{requests.map((request) => (
							<div key={request.id} className="rounded-lg border p-3">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<strong>{request.customerName || request.contactEmail || "Unnamed customer"}</strong>
									<div className="flex gap-2 text-xs"><span className="rounded-full border px-2 py-1">{request.demandType.replaceAll("_", " ")}</span><span className="rounded-full border px-2 py-1">{request.status}</span></div>
								</div>
								<div className="mt-2 text-sm">{request.items.map((item) => `${item.quantity == null ? "Qty TBD" : `${item.quantity.toString()}×`} ${productLabel(item)}`).join(" · ")}</div>
								<div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
									<span>Budget {usd(request.targetBudget)}</span>
									<span>Required {request.requiredBy ? request.requiredBy.toISOString().slice(0, 10) : "TBD"}</span>
									<span>Next: {request.nextAction ?? "Supplier sourcing / pricing"}</span>
									<span>Follow-up {request.followUpAt ? request.followUpAt.toISOString().slice(0, 10) : "not scheduled"}</span>
								</div>
							</div>
						))}
						{requests.length === 0 ? <p className="text-sm text-muted-foreground">No active demand yet.</p> : null}
					</CardContent>
				</Card>

				<Card>
					<CardHeader><CardTitle>Needs action</CardTitle></CardHeader>
					<CardContent className="space-y-3">
						{matrix.filter((row) => row.pricingStatus !== "LIVE" || row.leadTimeDays == null).slice(0, 8).map((row) => (
							<div key={row.supplierQuoteId} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3">
								<div><div className="font-medium">{row.supplierName} · {row.manufacturerSku ?? row.model ?? row.productName}</div><div className="mt-1 text-sm text-muted-foreground">{row.pricingStatus !== "LIVE" ? `Pricing status: ${row.pricingStatus}` : "Pricing live"} · {row.leadTimeDays == null ? "lead time missing" : `${row.leadTimeDays}d lead`}</div></div>
								<div className="text-right text-sm"><div className="font-medium">{usd(row.targetSellPrice)}</div><div className="text-xs text-muted-foreground">target sell</div></div>
							</div>
						))}
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader><CardTitle>Supplier buy / sell matrix</CardTitle></CardHeader>
				<CardContent className="overflow-x-auto">
					<table className="w-full min-w-[1050px] text-sm">
						<thead><tr className="border-b text-left text-muted-foreground"><th className="py-2">Product</th><th>Supplier</th><th>Buy</th><th>Landed</th><th>Target sell</th><th>GP</th><th>GM</th><th>Available</th><th>Lead</th><th>Status</th></tr></thead>
						<tbody>{matrix.map((row) => <tr key={row.supplierQuoteId} className="border-b last:border-0"><td className="py-3 pr-4"><div className="font-medium">{productLabel(row) || "Unlinked product"}</div><div className="text-xs text-muted-foreground">{row.manufacturerSku ?? row.category ?? ""}</div></td><td className="pr-4">{row.supplierName}</td><td>{usd(row.unitCost)}</td><td>{usd(row.landedCost)}</td><td className="font-medium">{usd(row.targetSellPrice)}</td><td>{usd(row.grossProfitPerUnit)}</td><td>{n(row.grossMarginPct)?.toFixed(2) ?? "—"}%</td><td>{n(row.availableQty) ?? "TBD"}</td><td>{row.leadTimeDays == null ? "TBD" : `${row.leadTimeDays}d`}</td><td>{row.pricingStatus}</td></tr>)}</tbody>
					</table>
				</CardContent>
			</Card>

			<div className="grid gap-4 xl:grid-cols-2">
				<Card><CardHeader><CardTitle>Demand aggregation</CardTitle></CardHeader><CardContent className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="py-2">Demand</th><th>Open qty</th><th>Requests</th><th>Target value</th><th>Required by</th></tr></thead><tbody>{demand.map((row) => <tr key={demandKey(row)} className="border-b last:border-0"><td className="py-3 pr-4"><div className="font-medium">{productLabel(row) || row.productType}</div><div className="text-xs text-muted-foreground">{row.manufacturerSku ?? row.productType}</div></td><td>{n(row.openQuantity) ?? "TBD"}</td><td>{Number(row.openRequests)}</td><td>{usd(row.statedTargetValue)}</td><td>{row.earliestRequiredBy ? row.earliestRequiredBy.toISOString().slice(0,10) : "TBD"}</td></tr>)}</tbody></table></CardContent></Card>
				<Card><CardHeader><CardTitle>Buying desk workflow</CardTitle></CardHeader><CardContent><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">1 · Demand</div><div className="mt-1 font-medium">Capture exact customer need</div></div><div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">2 · Source</div><div className="mt-1 font-medium">Consolidate supplier RFQs</div></div><div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">3 · Compare</div><div className="mt-1 font-medium">Landed cost, lead, GP, terms</div></div><div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">4 · Quote</div><div className="mt-1 font-medium">Turn selected supply into customer quote</div></div></div></CardContent></Card>
			</div>

			<details className="rounded-lg border">
				<summary className="cursor-pointer px-4 py-3 font-medium">+ New procurement record</summary>
				<div className="grid gap-4 border-t p-4 xl:grid-cols-2">
					<Card><CardHeader><CardTitle>Add supplier</CardTitle></CardHeader><CardContent><form action={createSupplier} className="grid gap-3 md:grid-cols-2"><input type="hidden" name="slug" value={slug}/><Input name="supplierName" placeholder="Supplier name" required/><Input name="contactName" placeholder="Contact"/><Input name="contactEmail" type="email" placeholder="Email"/><Input name="contactPhone" placeholder="Phone"/><Input name="paymentTerms" placeholder="Terms, e.g. Net 30"/><Input name="notes" placeholder="Notes"/><Button type="submit" className="md:col-span-2">Add supplier</Button></form></CardContent></Card>
					<Card><CardHeader><CardTitle>Add product / SKU</CardTitle></CardHeader><CardContent><form action={createProduct} className="grid gap-3 md:grid-cols-2"><input type="hidden" name="slug" value={slug}/><Input name="category" placeholder="Category, e.g. GPU server" required/><Input name="productName" placeholder="Product name" required/><Input name="manufacturer" placeholder="Manufacturer"/><Input name="model" placeholder="Model"/><Input name="manufacturerSku" placeholder="Manufacturer SKU"/><Button type="submit">Add product</Button></form></CardContent></Card>
					<Card><CardHeader><CardTitle>Add supplier quote</CardTitle></CardHeader><CardContent><form action={addSupplierQuote} className="grid gap-3 md:grid-cols-2"><input type="hidden" name="slug" value={slug}/><select name="supplierId" required className="h-9 rounded-md border bg-background px-3 text-sm"><option value="">Supplier</option>{suppliers.map((x)=><option key={x.id} value={x.id}>{x.supplierName}</option>)}</select><select name="productId" required className="h-9 rounded-md border bg-background px-3 text-sm"><option value="">Product</option>{products.map((x)=><option key={x.id} value={x.id}>{productLabel(x)}</option>)}</select><Input name="unitCost" type="number" step="0.01" min="0" placeholder="Unit cost" required/><Input name="quoteQuantity" type="number" min="1" defaultValue="1" placeholder="Quoted qty"/><Input name="shippingTotal" type="number" step="0.01" min="0" placeholder="Freight total"/><Input name="availableQty" type="number" min="0" placeholder="Available qty"/><Input name="leadTimeDays" type="number" min="0" placeholder="Lead time days"/><select name="availabilityStatus" className="h-9 rounded-md border bg-background px-3 text-sm"><option value="LIVE">LIVE</option><option value="RFQ">RFQ</option><option value="UNAVAILABLE">UNAVAILABLE</option></select><Input name="sourceRef" placeholder="Quote/email reference"/><Input name="notes" placeholder="Notes"/><Button type="submit" className="md:col-span-2">Save supplier quote</Button></form></CardContent></Card>
					<Card><CardHeader><CardTitle>Log customer request</CardTitle></CardHeader><CardContent><form action={createCustomerRequest} className="grid gap-3 md:grid-cols-2"><input type="hidden" name="slug" value={slug}/><Input name="customerName" placeholder="Customer"/><select name="demandType" className="h-9 rounded-md border bg-background px-3 text-sm"><option value="PURCHASE">Purchase</option><option value="LEASE">Lease</option><option value="CLOUD_CAPACITY">Cloud capacity</option></select><Input name="productType" placeholder="Product type" required/><select name="productId" className="h-9 rounded-md border bg-background px-3 text-sm"><option value="">Match known product (optional)</option>{products.map((x)=><option key={x.id} value={x.id}>{productLabel(x)}</option>)}</select><Input name="manufacturer" placeholder="Manufacturer"/><Input name="model" placeholder="Model"/><Input name="manufacturerSku" placeholder="Exact SKU"/><Input name="quantity" type="number" min="1" step="1" placeholder="Qty (blank = TBD)"/><Input name="gpuModel" placeholder="GPU model"/><Input name="gpuCount" type="number" min="0" placeholder="GPU count"/><Input name="customerTargetUnitPrice" type="number" min="0" step="0.01" placeholder="Target unit price"/><Input name="targetBudget" type="number" min="0" step="0.01" placeholder="Total budget"/><Input name="requiredBy" type="date"/><Input name="destination" placeholder="Destination"/><Input name="nextAction" placeholder="Next action"/><Input name="followUpAt" type="date"/><Textarea name="originalRequest" placeholder="Original customer request / configuration" className="md:col-span-2"/><Button type="submit" className="md:col-span-2">Log customer request</Button></form></CardContent></Card>
				</div>
			</details>
		</div>
	);}
