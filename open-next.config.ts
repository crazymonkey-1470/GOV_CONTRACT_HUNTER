import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No incremental cache: every dashboard page is rendered per request for the
// signed-in user, so there is nothing for ISR to cache (and no R2 bucket to set up).
export default defineCloudflareConfig();
