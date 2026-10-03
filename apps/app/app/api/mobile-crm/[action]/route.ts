import { auth } from "@crm/auth";
import { headers } from "next/headers";
import { ZodError } from "zod";
import {
	buildCrmMobileRequest,
	crmMobileAction,
} from "@/lib/crm-mobile-actions";
import { API_URL } from "@/lib/env";

function copyRequestHeaders(source: Headers): Headers {
	const target = new Headers(source);
	for (const name of [
		"host",
		"content-length",
		"transfer-encoding",
		"connection",
		"keep-alive",
		"expect",
	]) {
		target.delete(name);
	}
	target.set("accept", "application/json");
	return target;
}

async function post(
	request: Request,
	context: { params: Promise<{ action: string }> },
): Promise<Response> {
	const requestHeaders = await headers();
	const session = await auth.api.getSession({ headers: requestHeaders });
	if (!session) {
		return Response.json({ error: "unauthorized" }, { status: 401 });
	}

	const { action: rawAction } = await context.params;
	const parsedAction = crmMobileAction.safeParse(rawAction);
	if (!parsedAction.success) {
		return Response.json({ error: "unknown_action" }, { status: 404 });
	}

	let input: unknown = {};
	try {
		const text = await request.text();
		input = text.trim() ? (JSON.parse(text) as unknown) : {};
	} catch {
		return Response.json({ error: "invalid_json" }, { status: 400 });
	}

	try {
		const mapped = buildCrmMobileRequest(parsedAction.data, input);
		const upstreamHeaders = copyRequestHeaders(requestHeaders);
		if (mapped.body !== undefined) {
			upstreamHeaders.set("content-type", "application/json");
		} else {
			upstreamHeaders.delete("content-type");
		}

		const upstream = await fetch(`${API_URL}${mapped.path}`, {
			method: mapped.method,
			headers: upstreamHeaders,
			body:
				mapped.body === undefined ? undefined : JSON.stringify(mapped.body),
			redirect: "manual",
			cache: "no-store",
		});

		const body = await upstream.text();
		const responseHeaders = new Headers();
		responseHeaders.set(
			"content-type",
			upstream.headers.get("content-type") ?? "application/json",
		);
		return new Response(body, {
			status: upstream.status,
			statusText: upstream.statusText,
			headers: responseHeaders,
		});
	} catch (error) {
		if (error instanceof ZodError) {
			return Response.json(
				{
					error: "invalid_input",
					issues: error.issues.map((issue) => ({
						path: issue.path.join("."),
						message: issue.message,
					})),
				},
				{ status: 400 },
			);
		}

		console.error("Mobile CRM action failed", error);
		return Response.json({ error: "crm_action_failed" }, { status: 502 });
	}
}

export { post as POST };
