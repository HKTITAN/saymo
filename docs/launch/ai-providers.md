# AI sign-ins in a product

Anthropic's rule, from the Claude Agent SDK docs (https://code.claude.com/docs/en/agent-sdk/overview, read on 2026-11-03):

> Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods described in the Quickstart instead.

So "Claude on your Claude plan", the studio's default today (`src/lib/studio/providers.ts`, `src/lib/studio/ai-types.ts`), can't be in a product people pay for. The owner doesn't expect Anthropic to approve it, so plan without it.

## What works

1. **Bring your own key.** Each customer pastes their own Anthropic API key; the studio already has "Claude with an API key". Anthropic bills the customer directly under its commercial terms, and we never carry their usage. The simplest way to start.
2. **Our key, our price.** Turns run on our own API key, and we charge for credits or a plan that covers the cost. This needs metering, a limit per customer, and prices set from the measured cost of real turns. Today every turn is Opus 5.5 at high effort; a cheaper model for small steps cuts that a lot.
3. **The customer's cloud.** Claude through Amazon Bedrock, Google Vertex AI or Microsoft Foundry, on the customer's own cloud account. Suits companies that already buy AI that way.
4. **Other models.** Keep the provider layer open (OpenAI API key, Gemini, local models), so no single provider decides whether the product can exist.

## What not to do

- **Driving the customer's own Claude Code.** Having the product run a customer's own Claude Code, signed in with their Pro or Max plan, is the same thing in another form: their plan's limits would power our product, which is what the rule forbids, and it puts their accounts at risk.
- **Shipping "Codex on your ChatGPT plan" unchecked.** OpenAI's terms for this weren't checked; check them before shipping that option.

## The owner's own use

Running the studio yourself on your own Claude plan is ordinary Claude Code use. The rule applies once it's a product other people use.
