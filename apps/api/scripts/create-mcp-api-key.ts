import { auth, DAY_SECONDS } from "@crm/auth";
import { db } from "@crm/db";

const email =
  process.argv[2]?.trim().toLowerCase() ??
  process.env.COMP_CRM_MCP_USER_EMAIL?.trim().toLowerCase();

if (!email) {
  throw new Error(
    "Provide the CRM user email as the first argument or set COMP_CRM_MCP_USER_EMAIL.",
  );
}

try {
  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, email: true },
  });

  if (!user) throw new Error(`No CRM user exists for ${email}.`);

  const created = await auth.api.createApiKey({
    body: {
      name: "Comp CRM MCP",
      expiresIn: 365 * DAY_SECONDS,
      userId: user.id,
      rateLimitEnabled: false,
    },
  });

  process.stdout.write(`COMP_CRM_API_KEY=${created.key}\n`);
} finally {
  await db.$disconnect();
}
