# Getting paid

Researched on 2026-11-03 from Polar's own docs and terms, by two research agents working in parallel. Fees, payouts, the countries list and the acceptable use policy were then checked again by hand. Prices like $49 and $15 below are examples, not decisions. This isn't tax or legal advice: a chartered accountant should check the India part, and the lawyer (step 10 of the plan) Polar's terms.

## In short

1. **Polar fits.** It sells to the customer as the merchant of record (it charges the tax and handles disputes), it pays out to an Indian bank account, and its licence keys can be checked by the Mac app without a secret.
2. **The risk is approval.** Polar's acceptable use policy lists "AI Content Generation tools (text, image, video, voice)" among the businesses that "require a closer review and may not be accepted". Take avatars, voice cloning and lip-sync out of the product edition before applying, and describe the product accurately.
3. **Start on the free Starter plan:** 5% + 50¢ a sale, plus 1.5% on cards from outside the US. Pro ($20 a month) pays off from about $1,379 a month in sales.
4. **Sell a licence key,** for a one-time licence or a subscription. The Mac app activates the key once and checks it at launch.
5. **Agentic checkout already works, for one-time prices.** Since 26 October 2026, AI agents built with Agentcard can pay any Polar checkout once the buyer approves, with nothing for us to build. ChatGPT's and Google's in-chat checkouts are closed to us while Polar is the seller.

## Fees

From https://polar.sh/docs/merchant-of-record/fees.md. Organisations created from 27 May 2026 start on Starter; older ones keep the Early Member rate (4% + 40¢, plus 0.5% on subscriptions).

| Plan | Monthly | Per sale | Polar keeps on a $49 sale (US card / non-US card) | On a $15 charge |
| --- | --- | --- | --- | --- |
| Starter | $0 | 5% + 50¢ | $2.95 / $3.69 | $1.25 / $1.48 |
| Pro | $20 | 3.8% + 40¢ | $2.26 / $3.00 | $0.97 / $1.20 |
| Growth | $100 | 3.6% + 35¢ | $2.11 / $2.85 | $0.89 / $1.12 |
| Scale | $400 | 3.4% + 30¢ | $1.97 / $2.70 | $0.81 / $1.04 |

- The fee is taken on the total the buyer pays, tax included.
- Polar's own break-even against Starter: Pro from about $1,379 a month in sales, Growth from $5,634, Scale from $19,048.
- Refunds: Polar keeps its fee, and may refund a buyer itself within 60 days to head off a chargeback, even under a no-refunds policy. A dispute costs $15 by the docs, and the Master Services Terms allow up to $25 to $30. Chargebacks must stay under 0.4% of sales.
- Payouts carry Stripe's fees at cost: see "Getting paid in India".

## Which way to sell

- **One-time licence:** a one-time product with the License Keys benefit. Polar's trials only work on subscriptions, so a free trial of a one-time licence has to live in the app. Discounts can be codes, percentages or fixed amounts, with dates and per-customer limits.
- **Subscription:** monthly and yearly are separate products, with optional trials (card up front, a reminder 3 days before the first charge). A failed renewal is retried over 21 days, and the key is revoked at the first failure unless the benefit has a grace period of 2 to 21 days; 14 days is a sensible setting.
- **Credits:** Polar has meters and a Credits benefit, but it never blocks usage, so our own server would have to check the balance. They'd suit a hosted render service later. They can't sell Claude turns on our own key while the studio runs Claude Code (see [ai-providers.md](ai-providers.md)).

## Licence keys in the Mac app

These three calls need no secret token; Polar calls them "safe on a public client, like a desktop application" (https://polar.sh/docs/features/benefits/license-keys.md). The base URL is https://api.polar.sh, and the sandbox's is https://sandbox-api.polar.sh.

| Call | Send | Get back |
| --- | --- | --- |
| `POST /v1/customer-portal/license-keys/activate` | `key`, `organization_id`, `label` (the Mac's name), and optionally `conditions` (a hashed hardware ID) and `meta` | an activation id, or 403 if the key is revoked, expired or at its activation limit |
| `POST /v1/customer-portal/license-keys/validate` | `key`, `organization_id`, `activation_id`, and optionally `conditions`, which must match | 200 with `status` "granted", `expires_at` and the activation, or 404 if the key isn't found, is revoked or expired, or doesn't match |
| `POST /v1/customer-portal/license-keys/deactivate` | `key`, `organization_id`, `activation_id` | 204 |

How the app should use them: activate once, keep the key and the activation id in the macOS Keychain, validate at each launch, and lock on a 404. Through network errors, keep working on the last good answer for about 14 days. Deactivate on sign-out. The activation limit is set on the benefit (2 Macs is a fair start), and customers can free a Mac or replace a leaked key in Polar's customer portal.

Traps:
- Subscription keys don't expire on their own. Polar revokes them when the subscription ends, at the end of the period after a cancel. Refunding a one-time order revokes its key by default.
- Polar retires API versions after about nine months, and a retired version answers 404, which looks like a bad key. Don't pin a version in the app without a way to update it, and read only `status`, `expires_at` and the activation. Check https://polar.sh/docs/api-reference/current/versioning.md before shipping.
- These calls are limited to 3 a second.
- Validate returns the buyer's email and address, so treat keys as secrets.

## Taking the money on the website

- **The Next.js adapter,** `@polar-sh/nextjs` 1.1.0 (6 October 2026), is maintained and supports Next 15 and 16. It gives route handlers for checkout, the customer portal and webhooks. Polar deprecated its other framework adapters, not this one.
- **A checkout link** is the no-code option: Polar hosts the page, with Apple Pay and Google Pay. **An embedded checkout** opens over our own page, but our domain has to be allowed, and wallets need an email to Polar.
- **The customer portal** is at polar.sh/<our slug>/portal, with sign-in by an emailed code.
- **Webhooks:** Polar grants and revokes licence keys itself, so the site only needs webhooks for its own records (`order.paid`, `order.refunded`, `subscription.updated` and `subscription.revoked`, or just `customer.state_changed`). Answer within 2 seconds; 10 failures in a row disable the endpoint.
- **The sandbox** is a separate account with its own tokens. Its test card is 4242 4242 4242 4242.

## Polar's review

- Before the first payout, Polar checks the business, an ID with a selfie, and the Stripe payout account. It can take up to 14 days. Apply once the website and checkout are finished. Polar may ask for a 100% discount code to try the purchase; don't test with real cards.
- The site must describe the product and its price accurately, and show that Polar sells it as the merchant of record. A subscription must also show its billing interval, that it renews, how to cancel, and who can get a refund. No published checklist names terms, privacy or contact pages, but have all three.
- Support threads need an answer within 48 hours.
- **Acceptable use** (https://polar.sh/legal/acceptable-use-policy): "AI Content Generation tools (text, image, video, voice)" and "Audio / music / chatbot generators (no voice cloning, NSFW, IP infringements or fake claims)" are listed under "Restricted businesses that require closer review", which "may not be accepted". Approval "may depend on factors including the nature of the product, business maturity, ownership and funding, safeguards, and risk profile". Banned outright: content generation that "enables face swaps or deep fakes, or produces adult content", and third-party content downloaders. Nothing in the policy stops customers bringing their own AI.
- **What to change first:** the product edition mustn't ship the HeyGen voice cloning, lip-sync, video translation and avatar videos that the bundled `media-use` skill offers (`.claude/skills/media-use/references/operations.md`, lines 59 to 62 and 244 to 258). The studio's own voiceovers are voice generation too, so be ready to explain them, and their safeguards, in the review.

## Polar's MCP server and CLI

- **MCP server:** https://mcp.polar.sh/mcp/polar-mcp (sandbox: https://mcp.polar.sh/mcp/polar-sandbox), signed in as you through OAuth. It can search and run over 100 operations, refunds and revokes included, so add `?readonly=true` unless it should change things.
- **CLI:** `polar webhook listen` forwards events to localhost, `polar webhook trigger` sends sample events, and every API resource has a command.

## Getting paid in India

From Polar's pages on supported countries, payout accounts, payouts and the balance:

- **India is on Polar's payout list.** Polar's FAQ: "any individual or company operating in our supported countries can receive payouts from Polar even if Stripe standalone is invite-only there". This works because customers pay Polar (US), and Stripe Connect Express only handles the transfer. Selling as an individual works if Stripe Connect Express accepts individuals in India. Polar's FAQ shows how to check this in Stripe's verification guide: set the platform country to US, the dashboard to Express, the agreement to recipient, the capability to transfers, and the account country to India.
- **The bank account must be in India, in rupees.** Wise, Payoneer and similar accounts are usually refused.
- **The money:** the balance is kept in US dollars. Payouts are manual, from $10, and each sale is held for 7 days first (for organisations created after 12 May 2026). A payout arrives in 4 to 7 business days. Each one costs 0.25% + 25¢, there's $2 for any month with a payout, and converting to rupees costs up to 1%.
- **Invoices:** for each payout, download Polar's reverse invoice (Finance, then Payouts). It's your invoice to Polar for the sales it made for you, minus its fees, with room for your GSTIN or other tax details.

India's tax side, for a chartered accountant to confirm. This comes from payment companies' guides, not government sources:

- Selling through Polar most likely makes your customer Polar, a US company, so each sale is an export of services. That's zero-rated for GST, invoiced under a Letter of Undertaking (LUT, filed each year on the GST portal on form RFD-11) once you're registered.
- GST registration becomes compulsory above ₹20 lakh of turnover a year (₹10 lakh in special-category states).
- GST officers ask for a FIRA or FIRC as proof that foreign money came in. It isn't confirmed whether Stripe's rupee payouts come with one, so ask Stripe and your bank before the first payout.

## Agentic checkout

An AI agent finding the product and paying for it for its user. Researched on 2026-11-03 by the second agent; Polar's announcement, Agentcard's post and Polar's pull request were then checked by hand.

### What works for us today

- **Polar's agentic checkouts.** On 27 October 2026 Polar announced: "agents can now pay on any Polar checkout, with your approval, through @agentcardhq" (https://x.com/polar_sh/status/2115088317364502558). Agentcard's post says "Polar turned agentic checkouts on for every seller on 26 October, so if you sell on Polar, you can already take payments from agents", and "There's nothing to build." The buyer approves each payment, and the agent gets a one-time permission that only works for that amount, in that currency, and expires (https://agentcard.com/blog/polar-agentic-checkouts).
  - Underneath, Polar's checkout now accepts Stripe Shared Payment Tokens, for one-time payments only (polarsource/polar pull request 15618, merged 19 October, in API version 2027-01). Subscriptions are an open proof of concept (pull request 16014). None of this is in Polar's docs yet.
  - Limits: only agents built with Agentcard can use it (an invite-based company selling to agent makers), and Stripe limits Shared Payment Token buyers to the US, Canada and parts of Europe.
  - What it means for pricing: keep at least one one-time price, such as a licence or a credit pack, because that's all an agent can pay on Polar today.
- **Agents with a payment card.** Stripe's Link agent wallet gives US and Canadian buyers' agents a one-time virtual card that works on any card form, including Polar's normal checkout page.
- **A site agents can read.** Let AI crawlers such as OAI-SearchBot in, keep the pricing in the page's HTML, add schema.org `SoftwareApplication` data with an `Offer`, add an `llms.txt` (only a proposal, though Stripe's agent directory asks for one), and give each plan a plain link to its Polar checkout.
- **A "buy" tool in the studio's MCP server and CLI** that returns the plan's Polar checkout link. Checkout links are public, permanent URLs that take `customer_email`, `discount_code`, `reference_id` and `utm_*`, so no Polar key ships in the app. The MCP server runs on the customer's Mac, so this helps with upgrades rather than discovery. An Agentcard agent could pay the link itself.

### Closed to us while Polar is the merchant of record

- **ChatGPT Instant Checkout** (the Agentic Commerce Protocol): a beta for approved partners, with US product feeds, and the seller must be the merchant of record on its own payment processor. Third-party reports say OpenAI scaled it back in March 2026.
- **Google's Universal Commerce Protocol** (AI Mode and Gemini): early access, US first, with Australia and Canada "early next year". The seller stays the merchant of record, and software isn't mentioned.
- **Stripe's Agentic Commerce Suite:** needs our own Stripe account, and Stripe lists India as "Preview".
- Only Polar itself could join these three, as a platform, and there's no sign of that yet.
- **Agent Payments Protocol (AP2)** is a protocol with no seller programme (Google gave it to the FIDO Alliance on 28 April 2026). Visa's and Mastercard's agent programmes go through banks and processors, not small sellers.
- **Anthropic** offers no checkout inside Claude. Claude's connector directory turns down connectors that move money or "generate images, video, or audio through AI models", which may rule out listing the studio's MCP server there.

### Wrong fit for now: paying per render

x402 and the Machine Payments Protocol let agents pay per request. Renders run on the customer's Mac with their own Claude, so there's nothing on our server to charge for, and a check inside the app is easy to remove. They'd only fit a hosted service, and those payments would bypass Polar: we'd hold crypto, owe the tax ourselves, and need our own Stripe account for cards.

### What to do

1. **Now:** make the site readable by agents, add the "buy" tool, and keep at least one one-time price.
2. **Wait for:** subscriptions on Polar's agentic checkouts, and Polar's docs on them; Google's protocol outside the US; ChatGPT taking software; Polar joining either protocol as a platform.

## Steps, in order

1. **Product edition:** take out avatars, voice cloning, lip-sync and video translation (see "Polar's review").
2. **Polar sandbox:** an organisation, a License Keys benefit (prefix `MOTION_`, 2 Macs, customers can deactivate), and a one-time product. Later, monthly and yearly products with a 14-day grace period. Set the prices.
3. **Website** (`~/Desktop/projects/motion-tool-website`, built by lorenzo): a checkout route, a portal link, a webhook route, and the pages Polar's review needs.
4. **Mac app:** activate, validate at launch and deactivate on sign-out, as above.
5. **Test** everything in the sandbox, then recreate it in production.
6. **Payouts:** connect the payout account (an Indian bank, in rupees), finish the identity checks, and submit for review.
7. **A chartered accountant:** whether to register for GST, the LUT, and the FIRA question.
8. **Plan:** stay on Starter, and move to Pro near $1,379 a month in sales.
9. **Agents:** make the site readable by agents, and add a "buy" tool to the studio's MCP server and CLI (see "Agentic checkout").

## Sources

- Polar fees and money: https://polar.sh/docs/merchant-of-record/fees.md, https://polar.sh/blog/introducing-polar-plans, https://polar.sh/docs/features/tax-inclusive-pricing.md, https://polar.sh/docs/features/refunds.md, https://polar.sh/legal/master-services-terms (sections 9 and 10)
- Selling models: https://polar.sh/docs/features/products.md, https://polar.sh/docs/features/subscriptions/trials.md, https://polar.sh/docs/features/subscriptions/failed-payments.md, https://polar.sh/docs/features/discounts.md, https://polar.sh/docs/features/seat-based-pricing.md, https://polar.sh/docs/features/benefits/credits.md, https://polar.sh/docs/features/usage-based-billing/billing.md
- Licence keys: https://polar.sh/docs/features/benefits/license-keys.md, https://polar.sh/docs/api-reference/2026-10/customer_portal/activate-license-key.md, https://polar.sh/docs/api-reference/2026-10/customer_portal/validate-license-key.md, https://polar.sh/docs/api-reference/2026-10/customer_portal/deactivate-license-key.md, https://polar.sh/docs/api-reference/current/versioning.md
- Website: https://polar.sh/docs/integrate/sdk/adapters/nextjs.md, https://polar.sh/docs/features/checkout/links.md, https://polar.sh/docs/features/checkout/embed.md, https://polar.sh/docs/integrate/webhooks/events.md, https://polar.sh/docs/integrate/webhooks/delivery.md, https://polar.sh/docs/integrate/sandbox.md
- Review: https://polar.sh/docs/merchant-of-record/account-reviews.md, https://polar.sh/legal/acceptable-use-policy
- MCP and CLI: https://polar.sh/docs/integrate/mcp.md, https://polar.sh/docs/integrate/cli/introduction.md
- India payouts: https://polar.sh/docs/merchant-of-record/supported-countries.md, https://polar.sh/docs/features/finance/accounts.md, https://polar.sh/docs/features/finance/payouts.md, https://polar.sh/docs/features/finance/balance.md, https://docs.stripe.com/connect/required-verification-information
- India tax (payment companies' guides): https://www.skydo.com/blog/fira-gst-refund-saas-exporters-india, https://razorpay.com/blog/lut-in-gst/
- Agentic checkout on Polar: https://x.com/polar_sh/status/2115088317364502558, https://agentcard.com/blog/polar-agentic-checkouts, https://github.com/polarsource/polar/pull/15618, https://github.com/polarsource/polar/pull/16014, https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens, https://docs.stripe.com/agentic-commerce/agents/link-agent-wallet
- Other programmes: https://www.agenticcommerce.dev/, https://developers.openai.com/commerce/guides/get-started, https://developers.google.com/merchant/ucp, https://stripe.com/blog/agentic-commerce-suite, https://ap2-protocol.org/, https://docs.stripe.com/payments/machine, https://mpp.dev/faq, https://docs.cdp.coinbase.com/x402/seller/facilitator, https://developer.visa.com/capabilities/visa-intelligent-commerce, https://claude.com/docs/connectors/building/review-criteria
- An agent-readable site: https://developers.openai.com/api/docs/bots, https://developers.google.com/search/docs/appearance/structured-data/software-app, https://llmstxt.org/, https://polar.sh/docs/features/checkout/links
