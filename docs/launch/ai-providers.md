# AI sign-ins in a product

Checked on 2026-11-03 against two Anthropic pages. The first version of this file said a product can't run the customer's own Claude Code on their Claude plan. That was wrong: Anthropic's Claude Code legal page allows it, with conditions.

## What Anthropic says

"Legal and compliance" in the Claude Code docs (https://code.claude.com/docs/en/legal-and-compliance), under "Can customers offer Claude Code in their products?":

> Unless we've mutually agreed otherwise, preinstalling or running Claude Code in your products or services (e.g. in hosted sandboxes or other agent infrastructure) requires agreeing to our Commercial Terms of Service and complying with the conditions below:
>
> - The Claude Code binary must not be modified. Claude Code must be installed and run as published by Anthropic, and customers may not remove, disable, or restrict any authentication method built into it (including methods that permit signing in with a Claude account or the user's own API key).
> - Customers may not pay for, resell, or intermediate Claude usage on their end users' behalf. Each end user must authenticate with their own Anthropic API key, Claude subscription plan credentials, or 3P inference provider credential (Amazon Bedrock, Google Cloud's Agent Platform, Microsoft Foundry). That usage is billed directly to the end user under their own agreement with Anthropic or, for third-party inference providers, with the applicable provider.

The same page, under "Authentication and credential use":

> Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, Max, or Ultra plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens

It adds that signing in to a Claude account "must complete through Anthropic's own flow", and:

> Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code as described under *Can customers offer Claude Code in their products?* above.

On names and logos, the same page says: "You can accurately say, in plain text, that your product has Claude Code preinstalled or that it runs Claude Code. But you can't use the Claude Code or Anthropic names or logos as part of your own product, feature, or company name, in your own logo, or in a way that suggests Anthropic built, endorses, or is partnered with your product."

The Agent SDK overview (https://code.claude.com/docs/en/agent-sdk/overview) still says: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK." Read together, the two pages mean our own app can't offer a Claude sign-in or spend people's plan limits for them, but the customer may sign in to the real Claude Code themselves, inside our product.

## What this allows

1. **The customer's own Claude, run by the studio.** The studio runs the customer's unmodified Claude Code, and the customer signs in to it themselves, with their Claude plan or their API key, through Claude Code's own sign-in. Anthropic bills them directly. On our side: accept Anthropic's Commercial Terms; never modify Claude Code, take over its sign-in, or read or store its tokens; never pay for or resell their Claude usage; and leave both sign-in options open.
2. **The customer's own agent, driving the studio.** The studio has no AI inside, and the customer's own Claude Code, Codex or Claude app drives it through the studio's MCP server and CLI ([docs/mcp.md](../mcp.md)). That's ordinary use of their own agent. Moneta sells this way ([shown on X on 2026-11-03](https://x.com/rahulbhadoriiya/status/2117544561652424965)): its site says "Moneta has no AI inside and nothing to subscribe to", and the customer starts it with `claude "read MONETA.md"` in its folder.
3. **The customer's cloud.** Claude through Amazon Bedrock, Google Cloud or Microsoft Foundry, on the customer's own account, which Claude Code supports.
4. **Other models.** Keep the provider layer open (OpenAI, Gemini, local models), so no single provider decides whether the product can exist.

## What it doesn't allow

- A "Sign in with Claude" of our own, or anything that reads, stores or passes on the customer's Claude sign-in or tokens.
- Sending requests through the customer's plan on their behalf outside Claude Code.
- Our key, our price, while the studio runs Claude Code: each customer must use their own credentials, and we may not pay for or resell their usage. Selling AI turns on our own key would mean running our own agent on the Claude API instead of Claude Code; ask Anthropic how the Commercial Terms apply before planning that.
- Anthropic's or Claude's names or logos in our name or logo, or anywhere that suggests they built or endorse the studio. Plain text such as "runs Claude Code on your Mac" is fine.
- "Codex on your ChatGPT plan" before OpenAI's terms are read.

## What changes in the product edition

**Done on 2026-11-03:** the product edition now offers both, the plan through Claude Code's own sign-in (`claudeEnvFor()` passes no key and leaves Claude Code's own settings alone for it) and the API key (in its own settings folder, `.studio/claude`). Before that, step 3 of the plan made the product edition API key only: `claudeEnvFor()` in `src/lib/studio/providers.ts` hides the Mac's own Claude sign-in. The first condition says a product that runs Claude Code mustn't restrict its sign-in methods, so the product edition should offer both the customer's Claude plan and their API key, each signed in through Claude Code itself. The in-house edition already runs on the Mac's own Claude Code sign-in.

## The owner's own use

Running the studio yourself on your own Claude plan is ordinary Claude Code use.
