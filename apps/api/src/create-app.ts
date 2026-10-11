import type { IncomingMessage } from "node:http";
import { API_KEY_HEADER, apiUrl, SESSION_COOKIE_NAME } from "@crm/auth";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
	ExpressAdapter,
	type NestExpressApplication,
} from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import type { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import { AppRouterHost } from "nestjs-trpc";
import {
	createOpenApiExpressMiddleware,
	generateOpenApiDocument,
} from "trpc-to-openapi";
import { AppModule } from "./app.module";
import { ContextLogger } from "./logging/context-logger";
import { REST_BRIDGE_PATH } from "./trpc/openapi";
import { createBaseTrpcContext } from "./trpc/trpc.context";

type RawBodyRequest = IncomingMessage & { rawBody?: Buffer };

const RESEND_WEBHOOK_RAW_BODY_LIMIT = 512_000;

function captureResendWebhookRawBody(
	request: IncomingMessage,
	response: Response,
	next: NextFunction,
) {
	const rawBodyRequest = request as RawBodyRequest;
	const chunks: Buffer[] = [];
	let byteLength = 0;
	let finished = false;

	request.on("data", (chunk: Buffer | string) => {
		if (finished) return;

		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		byteLength += buffer.length;
		if (byteLength > RESEND_WEBHOOK_RAW_BODY_LIMIT) {
			finished = true;
			response.status(413).end();
			request.destroy();
			return;
		}

		chunks.push(buffer);
	});

	request.on("end", () => {
		if (finished) return;
		finished = true;
		rawBodyRequest.rawBody = Buffer.concat(chunks);
		next();
	});

	request.on("error", (error) => {
		if (finished) return;
		finished = true;
		next(error);
	});
}

export async function createApp(): Promise<NestExpressApplication> {
	const app = await NestFactory.create<NestExpressApplication>(
		AppModule,
		new ExpressAdapter(),
		{ bodyParser: false, logger: new ContextLogger() },
	);

	// Capture provider webhook bytes before Nest/Express route handling so
	// signature verification always uses the original request payload.
	app.use("/webhooks/resend/crm-ingest", captureResendWebhookRawBody);

	app.use(helmet());
	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			forbidNonWhitelisted: true,
			transform: true,
			transformOptions: { enableImplicitConversion: true },
		}),
	);

	let restBridge: ((req: Request, res: Response) => Promise<void>) | undefined;
	app.use(
		REST_BRIDGE_PATH,
		(req: Request, res: Response, next: NextFunction) => {
			if (!restBridge) {
				next();
				return;
			}
			void restBridge(req, res);
		},
	);

	const apiKeySecurityScheme = {
		type: "apiKey",
		in: "header",
		name: API_KEY_HEADER,
	} as const;

	// SwaggerModule.setup() registers its Express routes synchronously, so it must
	// happen before app.init() the same way the REST bridge does — Nest's own
	// routing (wired up during init) otherwise shadows anything registered after
	// it. The factory form defers building the document (which needs the tRPC
	// router, only available post-init) to first request instead.
	SwaggerModule.setup(
		"",
		app,
		() => {
			const { appRouter } = app.get(AppRouterHost);

			const trpcDocument = generateOpenApiDocument(appRouter, {
				title: "CRM API — tRPC bridge",
				description:
					"Every tRPC procedure, reachable over REST for tooling that cannot speak tRPC. Same validation, same middlewares, same services as the tRPC transport — this only translates the wire format.",
				version: "1.0",
				baseUrl: `${apiUrl}${REST_BRIDGE_PATH}`,
				securitySchemes: { apiKey: apiKeySecurityScheme },
			});

			const swaggerConfig = new DocumentBuilder()
				.setTitle("CRM API")
				.setDescription(
					`REST surface of the CRM API — auth, health, the internal cron routes, and a generated REST bridge (under ${REST_BRIDGE_PATH}) for every tRPC procedure.`,
				)
				.setVersion("1.0")
				.addCookieAuth(SESSION_COOKIE_NAME)
				.addApiKey(apiKeySecurityScheme, "apiKey")
				.build();
			const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);

			swaggerDocument.paths = {
				...swaggerDocument.paths,
				...(trpcDocument.paths as typeof swaggerDocument.paths),
			};
			swaggerDocument.components = {
				...swaggerDocument.components,
				schemas: {
					...swaggerDocument.components?.schemas,
					...(trpcDocument.components?.schemas as NonNullable<
						typeof swaggerDocument.components
					>["schemas"]),
				},
			};

			return swaggerDocument;
		},
		{ jsonDocumentUrl: "openapi.json" },
	);

	await app.init();

	const { appRouter } = app.get(AppRouterHost);

	restBridge = createOpenApiExpressMiddleware({
		router: appRouter,
		createContext: ({ req }) => createBaseTrpcContext(req),
	});

	return app;
}
