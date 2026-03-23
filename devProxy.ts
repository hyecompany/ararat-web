const LISTEN_PORT = 3001;

const TLS_CERT_PATH = "./server.crt";
const TLS_KEY_PATH = "./server.key";

const API_HTTP_TARGET = "https://127.0.0.1:8443";
const API_WS_TARGET = "wss://127.0.0.1:8443";

const APP_HTTP_TARGET = "http://127.0.0.1:3000";
const APP_WS_TARGET = "ws://127.0.0.1:3000";

// Development only: allow proxying to self-signed TLS upstreams (e.g. 127.0.0.1:8443).
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

function isSelfSignedDevApiTarget(url: URL): boolean {
	return url.protocol === "https:" && url.hostname === "127.0.0.1" && url.port === "8443";
}

type ProxySocketData = {
	targetUrl: string;
	upstreamHeaders: Record<string, string>;
	pendingMessages: Array<string | ArrayBuffer | Uint8Array | Blob>;
	upstream?: WebSocket;
};

function isApiPath(pathname: string): boolean {
	return !pathname.startsWith("/ui");
}

function getHttpTarget(url: URL): URL {
	const isApi = isApiPath(url.pathname);
	const base = isApi ? API_HTTP_TARGET : APP_HTTP_TARGET;
	// Pass the full pathname as-is (app routes keep /ui, api routes don't have /ui)
	return new URL(`${url.pathname}${url.search}`, base);
}

function getWsTarget(url: URL): URL {
	const isApi = isApiPath(url.pathname);
	const base = isApi ? API_WS_TARGET : APP_WS_TARGET;
	return new URL(`${url.pathname}${url.search}`, base);
}

async function proxyHttpRequest(req: Request): Promise<Response> {
	const incomingUrl = new URL(req.url);
	const targetUrl = getHttpTarget(incomingUrl);
	const isAppRoute = !isApiPath(incomingUrl.pathname);

	const headers = new Headers(req.headers);

	const init: RequestInit & { tls?: { rejectUnauthorized: boolean } } = {
		method: req.method,
		headers,
		redirect: "manual",
	};

	if (isSelfSignedDevApiTarget(targetUrl)) {
		init.tls = { rejectUnauthorized: false };
	}

	if (req.method !== "GET" && req.method !== "HEAD") {
		init.body = req.body;
	}

	try {
		const upstreamResponse = await fetch(targetUrl, init);

		const responseHeaders = new Headers(upstreamResponse.headers);

		const location = responseHeaders.get("location");
		if (location) {
			try {
				const resolvedLocation = new URL(location, targetUrl);
				if (
					resolvedLocation.protocol === targetUrl.protocol &&
					resolvedLocation.host === targetUrl.host
				) {
					let redirectPath = `${resolvedLocation.pathname}${resolvedLocation.search}${resolvedLocation.hash}`;
					// For app routes, ensure /ui prefix is present (but don't double it)
					if (isAppRoute && !redirectPath.startsWith("/ui")) {
						redirectPath = `/ui${redirectPath}`;
					}
					const rewrittenLocation = new URL(redirectPath, incomingUrl.origin);
					responseHeaders.set("location", rewrittenLocation.toString());
				}
			} catch {
				// Keep upstream Location header as-is when parsing fails.
			}
		}

		// No rewriting needed - upstream 3000 already has basePath: '/ui' configured,
		// so it generates paths with /ui/ prefix already included.
		// Read the body and create a fresh response to ensure proper handling of gzip/encoding
		
		// Read the entire body to a buffer. This automatically decompresses gzip.
		const bodyBuffer = await upstreamResponse.arrayBuffer();
		
		// Remove content-encoding since we've already decompressed
		responseHeaders.delete("content-encoding");
		// Let browser auto-detect the content length
		responseHeaders.delete("transfer-encoding");

		return new Response(bodyBuffer, {
			status: upstreamResponse.status,
			statusText: upstreamResponse.statusText,
			headers: responseHeaders,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : "unknown upstream error";
		console.error(`[Proxy error for ${incomingUrl.pathname}] ${message}`);
		return new Response(`Proxy error: ${message}`, { status: 502 });
	}
}

const server = Bun.serve<ProxySocketData>({
	port: LISTEN_PORT,
	tls: {
		cert: Bun.file(TLS_CERT_PATH),
		key: Bun.file(TLS_KEY_PATH),
	},
	async fetch(req, server) {
		const isWebSocketUpgrade =
			req.headers.get("upgrade")?.toLowerCase() === "websocket";

		if (isWebSocketUpgrade) {
			const requestUrl = new URL(req.url);
			const targetUrl = getWsTarget(requestUrl);
			const isApiWs = isApiPath(requestUrl.pathname);
			const upstreamHeaders: Record<string, string> = {};
			if (isApiWs) {
				for (const name of [
					"cookie",
					"authorization",
					"origin",
					"user-agent",
					"sec-websocket-protocol",
				]) {
					const value = req.headers.get(name);
					if (value) {
						upstreamHeaders[name] = value;
					}
				}
			}

			const upgraded = server.upgrade(req, {
				data: {
					targetUrl: targetUrl.toString(),
					upstreamHeaders,
					pendingMessages: [],
				},
			});

			if (upgraded) {
				return;
			}

			return new Response("WebSocket upgrade failed", { status: 400 });
		}

		return proxyHttpRequest(req);
	},
	websocket: {
		open(client) {
			const wsOptions: {
				headers?: Record<string, string>;
				tls?: { rejectUnauthorized: boolean };
			} = {};

			if (Object.keys(client.data.upstreamHeaders).length > 0) {
				wsOptions.headers = client.data.upstreamHeaders;
			}

			if (isSelfSignedDevApiTarget(new URL(client.data.targetUrl))) {
				wsOptions.tls = { rejectUnauthorized: false };
			}

			const upstream =
				wsOptions.headers || wsOptions.tls
					? new WebSocket(client.data.targetUrl, wsOptions as any)
					: new WebSocket(client.data.targetUrl);
			upstream.binaryType = "arraybuffer";
			client.data.upstream = upstream;

			upstream.onopen = () => {
				for (const message of client.data.pendingMessages) {
					upstream.send(message);
				}
				client.data.pendingMessages = [];
			};

			upstream.onmessage = (event) => {
				if (typeof event.data === "string") {
					client.send(event.data);
					return;
				}

				if (event.data instanceof ArrayBuffer) {
					client.send(event.data);
					return;
				}

				if (event.data instanceof Uint8Array) {
					client.send(event.data);
					return;
				}

				if (event.data instanceof Blob) {
					void event.data.arrayBuffer().then((buffer) => {
						client.send(buffer);
					});
				}
			};

			upstream.onerror = (event) => {
				console.error(`Upstream WebSocket error for ${client.data.targetUrl}`, event);
				client.close(1011, "Upstream WebSocket error");
			};

			upstream.onclose = (event) => {
				client.close(event.code || 1000, event.reason);
			};
		},
		message(client, message) {
			const upstream = client.data.upstream;

			if (!upstream) {
				return;
			}

			if (upstream.readyState === WebSocket.CONNECTING) {
				client.data.pendingMessages.push(message);
				return;
			}

			if (upstream.readyState !== WebSocket.OPEN) {
				return;
			}

			upstream.send(message);
		},
		close(client, code, reason) {
			const upstream = client.data.upstream;

			if (!upstream) {
				return;
			}

			if (
				upstream.readyState === WebSocket.OPEN ||
				upstream.readyState === WebSocket.CONNECTING
			) {
				upstream.close(code, reason);
			}
		},
	},
});

console.log(`Hye Ararat listening on https://127.0.0.1:${server.port}`);
