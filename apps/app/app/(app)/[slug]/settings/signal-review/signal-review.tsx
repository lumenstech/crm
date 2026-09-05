"use client";

import { Button } from "@crm/ui/components/button";
import { Input } from "@crm/ui/components/input";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTRPC } from "@/lib/trpc/client";

export function SignalReview() {
	const [status, setStatus] = useState("pending");
	const [reason, setReason] = useState("");
	const trpc = useTRPC();
	const reviews = useQuery(
		trpc.resolution.listReviews.queryOptions({ limit: 50, status }),
	);
	const decide = useMutation(
		trpc.resolution.decide.mutationOptions({
			onSuccess: () => reviews.refetch(),
		}),
	);
	const process = useMutation(
		trpc.resolution.process.mutationOptions({
			onSuccess: () => reviews.refetch(),
		}),
	);
	return (
		<section className="space-y-4" aria-label="Resolution reviews">
			<div className="flex flex-wrap items-center gap-2">
				<label htmlFor="review-status" className="text-sm">
					Status
				</label>
				<select
					id="review-status"
					className="rounded-md border bg-background px-2 py-1 text-sm"
					value={status}
					onChange={(event) => setStatus(event.target.value)}
				>
					<option value="pending">Pending</option>
					<option value="resolved">Resolved</option>
					<option value="rejected">Rejected</option>
					<option value="ignored">Ignored</option>
				</select>
			</div>
			{reviews.isPending && (
				<p className="text-muted-foreground text-sm">Loading reviews…</p>
			)}
			{reviews.isError && (
				<p role="alert" className="text-destructive text-sm">
					Unable to load reviews.
				</p>
			)}
			{reviews.data?.length === 0 && (
				<p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
					No reviews match this filter.
				</p>
			)}
			<div className="grid gap-3">
				{reviews.data?.map((review) => (
					<article key={review.id} className="rounded-lg border p-4 shadow-sm">
						<div className="flex flex-wrap items-start justify-between gap-2">
							<div>
								<h2 className="font-medium">
									{review.entityType} · {review.reasonCode}
								</h2>
								<p className="text-muted-foreground text-sm">
									Source record {review.sourceRecordId}
								</p>
							</div>
							<span className="rounded bg-muted px-2 py-1 text-xs">
								{review.status}
							</span>
						</div>
						{review.candidates?.length ? (
							<div className="mt-3 space-y-1 text-sm">
								<p className="font-medium">Candidates</p>
								{review.candidates.map((candidate) => (
									<p
										key={`${candidate.canonicalType}-${candidate.canonicalId}`}
									>
										{candidate.canonicalType} {candidate.canonicalId} · score{" "}
										{candidate.score}
									</p>
								))}
							</div>
						) : null}
						{review.status === "pending" && (
							<div className="mt-4 flex flex-wrap items-center gap-2">
								<Input
									aria-label="Decision reason"
									placeholder="Decision reason"
									value={reason}
									onChange={(event) => setReason(event.target.value)}
									className="max-w-sm"
								/>
								<Button
									disabled={!reason.trim() || decide.isPending}
									onClick={() =>
										decide.mutate({
											reviewId: review.id,
											decision: "approved_match",
											canonicalId: review.candidates?.[0]?.canonicalId,
											reason,
											confirm: true,
										})
									}
								>
									Approve match
								</Button>
								<Button
									variant="outline"
									disabled={!reason.trim() || decide.isPending}
									onClick={() =>
										decide.mutate({
											reviewId: review.id,
											decision: "approved_new",
											reason,
											confirm: true,
										})
									}
								>
									Create new
								</Button>
								<Button
									variant="ghost"
									disabled={!reason.trim() || decide.isPending}
									onClick={() =>
										decide.mutate({
											reviewId: review.id,
											decision: "rejected",
											reason,
											confirm: true,
										})
									}
								>
									Reject
								</Button>
								<Button
									variant="ghost"
									disabled={process.isPending}
									onClick={() =>
										process.mutate({
											sourceRecordId: review.sourceRecordId,
											confirm: true,
										})
									}
								>
									Retry
								</Button>
							</div>
						)}
					</article>
				))}
			</div>
		</section>
	);
}
