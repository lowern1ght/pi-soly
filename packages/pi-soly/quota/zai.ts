// =============================================================================
// quota/zai.ts — Zhipu AI (zai / GLM) quota provider
// =============================================================================
//
// Adapter for the "zai" provider id. Implement fetch() to return a
// QuotaSnapshot — the poller + footer do the rest.
//
// TODO(zai): fill in the real fetch. Options:
//   (a) shell out to a CLI (like minimax does with `mmx`) if one exists
//   (b) read the API key from env (ZAI_API_KEY / ZHIPUAI_API_KEY) and
//       call the billing/quota endpoint directly via fetch()
// The shape below is the contract — replace the body of fetch().

import type { QuotaProvider, QuotaSnapshot } from "./types.ts";

/** Zhipu AI quota provider.
 *
 *  Register in index.ts:
 *    registerQuotaProvider(zaiProvider);
 *  Then any model with provider="zai" (or "zai-cn") shows the segment. */
export const zaiProvider: QuotaProvider = {
	id: "zai",
	async fetch(): Promise<QuotaSnapshot | null> {
		// TODO(zai): real implementation. Example shape if using HTTP:
		//
		//   const key = process.env.ZAI_API_KEY ?? process.env.ZHIPUAI_API_KEY;
		//   if (!key) return null;
		//   try {
		//     const res = await fetch("https://open.bigmodel.cn/api/paas/v4/billing", {
		//       headers: { Authorization: `Bearer ${key}` },
		//     });
		//     if (!res.ok) return null;
		//     const data = await res.json() as { remaining?: number; resetsAt?: string };
		//     return {
		//       remainingPercent: data.remaining,
		//       resetsInMs: data.resetsAt ? Date.parse(data.resetsAt) - Date.now() : null,
		//     };
		//   } catch {
		//     return null; // never throw — poller treats null as "no data"
		//   }
		//
		// Until implemented, return null (segment stays hidden for zai models).
		return null;
	},
};
