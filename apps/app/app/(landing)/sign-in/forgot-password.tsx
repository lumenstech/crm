"use client";

import { authClient } from "@crm/auth/client";
import { Button } from "@crm/ui/components/button";
import { Input } from "@crm/ui/components/input";
import { useState } from "react";
import { toast } from "sonner";

export function ForgotPassword() {
	const [open, setOpen] = useState(false);
	const [pending, setPending] = useState(false);
	const [sent, setSent] = useState(false);

	async function submit(formData: FormData) {
		const email = String(formData.get("email") ?? "").trim();
		if (!email) return;

		setPending(true);
		try {
			const { error } = await authClient.requestPasswordReset({
				email,
				redirectTo: `${window.location.origin}/reset-password`,
			});

			if (error) {
				toast.error(error.message || "Could not request a password reset.");
				return;
			}

			setSent(true);
		} catch {
			toast.error("Could not reach the authentication service.");
		} finally {
			setPending(false);
		}
	}

	if (!open) {
		return (
			<button
				type="button"
				className="w-full text-center text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
				onClick={() => setOpen(true)}
			>
				Forgot password?
			</button>
		);
	}

	if (sent) {
		return (
			<div className="rounded-md border p-3 text-sm text-muted-foreground">
				If that address exists, a password reset link has been sent.
			</div>
		);
	}

	return (
		<form action={(formData) => { void submit(formData); }} className="space-y-3 rounded-md border p-3">
			<Input name="email" type="email" placeholder="Email" autoComplete="email" required />
			<div className="flex gap-2">
				<Button type="submit" className="flex-1" disabled={pending}>
					{pending ? "Sending…" : "Send reset link"}
				</Button>
				<Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
					Cancel
				</Button>
			</div>
		</form>
	);
}
