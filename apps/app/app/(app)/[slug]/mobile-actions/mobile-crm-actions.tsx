"use client";

import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { Textarea } from "@crm/ui/components/textarea";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
	crmMobileActionNames,
	crmMobileExamples,
	type CrmMobileAction,
} from "@/lib/crm-mobile-actions";

function pretty(value: unknown) {
	return JSON.stringify(value, null, 2);
}

export function MobileCrmActions() {
	const searchParams = useSearchParams();
	const initialAction = useMemo(() => {
		const action = searchParams.get("action");
		return crmMobileActionNames.includes(action as CrmMobileAction)
			? (action as CrmMobileAction)
			: "search_crm";
	}, [searchParams]);

	const [action, setAction] = useState<CrmMobileAction>(initialAction);
	const [input, setInput] = useState(() => {
		const queryInput = searchParams.get("input");
		if (queryInput) {
			try {
				return pretty(JSON.parse(queryInput));
			} catch {}
		}
		return pretty(crmMobileExamples[initialAction]);
	});
	const [status, setStatus] = useState<string>("");
	const [output, setOutput] = useState<string>("");

	useEffect(() => {
		setAction(initialAction);
		const queryInput = searchParams.get("input");
		if (queryInput) {
			try {
				setInput(pretty(JSON.parse(queryInput)));
				return;
			} catch {}
		}
		setInput(pretty(crmMobileExamples[initialAction]));
	}, [initialAction, searchParams]);

	function chooseAction(next: CrmMobileAction) {
		setAction(next);
		setInput(pretty(crmMobileExamples[next]));
		setStatus("");
		setOutput("");
	}

	async function run() {
		setStatus("Running…");
		setOutput("");

		let parsed: unknown;
		try {
			parsed = input.trim() ? JSON.parse(input) : {};
		} catch {
			setStatus("Invalid JSON");
			return;
		}

		try {
			const response = await fetch(`/api/mobile-crm/${action}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(parsed),
			});
			const text = await response.text();
			let formatted = text;
			try {
				formatted = pretty(JSON.parse(text));
			} catch {}

			setOutput(formatted);
			setStatus(response.ok ? `Completed · HTTP ${response.status}` : `Failed · HTTP ${response.status}`);
		} catch (error) {
			setStatus("Request failed");
			setOutput(error instanceof Error ? error.message : "Unknown request error");
		}
	}

	return (
		<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
			<Card>
				<CardHeader>
					<CardTitle>CRM action</CardTitle>
					<CardDescription>
						Uses your signed-in CRM session and the existing CRM service layer.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<label className="grid gap-2 text-sm">
						<span className="font-medium">Action</span>
						<select
							value={action}
							onChange={(event) =>
								chooseAction(event.target.value as CrmMobileAction)
							}
							className="h-10 rounded-md border bg-background px-3"
						>
							{crmMobileActionNames.map((name) => (
								<option key={name} value={name}>
									{name}
								</option>
							))}
						</select>
					</label>

					<label className="grid gap-2 text-sm">
						<span className="font-medium">Input JSON</span>
						<Textarea
							value={input}
							onChange={(event) => setInput(event.target.value)}
							className="min-h-72 font-mono text-xs"
							spellCheck={false}
						/>
					</label>

					<Button type="button" onClick={run} className="w-full sm:w-auto">
						Run CRM action
					</Button>

					{status ? (
						<p className="text-sm text-muted-foreground">{status}</p>
					) : null}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Result</CardTitle>
					<CardDescription>
						The response comes from the existing authenticated CRM API.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<pre className="min-h-72 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs">
						{output || "Run an action to see the result."}
					</pre>
				</CardContent>
			</Card>
		</div>
	);
}
