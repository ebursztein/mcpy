import { UserAgentProfile } from "../enums.js";

export const MCPY_HOMEPAGE = "https://github.com/ebursztein/mcpy";

/**
 * User-agent strings per profile. The honest `mcpy` profile identifies the
 * tool; browser profiles exist for sites that serve bots a degraded page.
 * Update the browser versions when they age.
 */
export const USER_AGENTS: Record<UserAgentProfile, string> = {
  [UserAgentProfile.Mcpy]: `Mozilla/5.0 (compatible; mcpy/1.0; +${MCPY_HOMEPAGE})`,
  [UserAgentProfile.ChromeDesktop]:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  [UserAgentProfile.ChromeMobile]:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  [UserAgentProfile.SafariDesktop]:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  [UserAgentProfile.FirefoxDesktop]: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0",
  [UserAgentProfile.Googlebot]: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
};

export interface UserAgentConfig {
  /** Profile used when a call does not pick one. */
  defaultProfile: UserAgentProfile;
  /** Replaces the `mcpy` profile string (e.g. to add your own contact URL). */
  customMcpyString?: string;
}

export function resolveUserAgent(profile: UserAgentProfile, config: UserAgentConfig): string {
  if (profile === UserAgentProfile.Mcpy && config.customMcpyString) return config.customMcpyString;
  return USER_AGENTS[profile];
}
