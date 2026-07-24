// Cloudflare Pages Function: Proxy audio from GitHub release assets
// Avoids cross-origin issues and large uploads to Pages

const GITHUB_RELEASE_BASE =
	"https://github.com/cyjin-yl/yuxi/releases/download/40classic-songs-audio";

export async function onRequest(context: {
	request: Request;
	params: { file: string };
	env: Record<string, string>;
}): Promise<Response> {
	const { file } = context.params;

	if (!file || !file.endsWith(".m4a")) {
		return new Response("Not found", { status: 404 });
	}

	const url = `${GITHUB_RELEASE_BASE}/${encodeURIComponent(file)}`;

	try {
		const response = await fetch(url, {
			redirect: "follow",
			headers: {
				// Only forward headers the upstream needs
				"User-Agent": "Cloudflare-Pages-Proxy/1.0",
			},
		});

		if (!response.ok) {
			return new Response(`Upstream error: ${response.status}`, {
				status: response.status,
			});
		}

		// Stream the response body back with proper headers
		const headers = new Headers(response.headers);
		// Ensure correct content type for audio
		headers.set("Content-Type", "audio/mp4");
		// Enable range requests for seeking
		headers.set("Accept-Ranges", "bytes");
		// Cache for 1 hour on CF edge, 1 day in browser
		headers.set(
			"Cache-Control",
			"public, max-age=3600, s-maxage=86400"
		);
		// Remove any upstream headers that could cause issues
		headers.delete("Set-Cookie");

		return new Response(response.body, {
			status: response.status,
			headers,
		});
	} catch (error) {
		return new Response(
			`Proxy error: ${error instanceof Error ? error.message : "Unknown"}`,
			{ status: 502 }
		);
	}
}
