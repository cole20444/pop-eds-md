# AEM Guides → EDS POC — one-time Cloud setup needed

## TL;DR

We're building a proof-of-concept that delivers AEM Guides content through Adobe Edge Delivery Services (EDS). The AEM Guides side is configured, the EDS site is wired up, but **the Adobe-hosted publishing engine that converts DITA content into web pages isn't connected to our AEM dev environment yet**. It needs to be enabled once, per environment.

The setup requires creating an Adobe identity credential (one-time, Adobe Admin Console task) and deploying it to AEM (developer-side, handled by me).

## What we hit

When we try to publish a Guides map to the EDS site, AEM returns:

> *"Configure microservice on your cloud instance to use output type: FRANKLIN"*

Translation: Adobe runs the publishing engine on their cloud. Our AEM dev env needs an Adobe credential to authenticate to that engine. Without the credential, AEM can't talk to it, and publishing fails.

## How the pieces connect

```
┌──────────────────────────────┐     ┌──────────────────────┐     ┌──────────────────────────┐
│ Adobe Developer Console      │     │ Cloud Manager        │     │ AEM Project Repo         │
│ (Track 1 — Adobe org admin)  │ ──▶ │ (Track 2 — Cole)     │ ──▶ │ (Track 3 — Cole)         │
│                              │     │                      │     │                          │
│ Creates an OAuth credential  │     │ Stores credential    │     │ Tells AEM:               │
│ that grants AEM permission   │     │ JSON in a secret env │     │  - read the secret       │
│ to call Adobe IMS (identity) │     │ variable on the dev  │     │  - use it to auth to     │
│ on behalf of our org.        │     │ environment.         │     │    Adobe IMS             │
│                              │     │                      │     │  - then call the         │
│ Output: a JSON file with     │     │ Env var name:        │     │    publishing engine     │
│ client_id, client_secret,    │     │   SERVICE_ACCOUNT_   │     │                          │
│ technical_account_id,        │     │   DETAILS            │     │                          │
│ org_id, etc.                 │     │                      │     │                          │
└──────────────────────────────┘     └──────────────────────┘     └──────────────────────────┘
                                                                              │
                                                                              ▼
                                                              ┌──────────────────────────────┐
                                                              │ At runtime, AEM:             │
                                                              │  1. Reads the JSON from the  │
                                                              │     env var                  │
                                                              │  2. Calls Adobe IMS with the │
                                                              │     client_id / secret       │
                                                              │  3. Gets back an access      │
                                                              │     token                    │
                                                              │  4. Uses the token to call   │
                                                              │     Adobe's publishing       │
                                                              │     microservice             │
                                                              │  5. Microservice converts    │
                                                              │     DITA → HTML, commits to  │
                                                              │     our EDS GitHub repo      │
                                                              └──────────────────────────────┘
```

The OAuth credential in Track 1 is **the gating piece** — without it, the rest of the chain has nothing to authenticate with. Tracks 2 and 3 just transport and reference it.

---

## Track 1 — Adobe Developer Console (needs Adobe System Administrator)

**What we need them to create:** an **OAuth Server-to-Server credential** inside an Adobe Developer Console project, attached to the **I/O Management API**.

**Why we need it:** That credential lets AEM authenticate to Adobe IMS as our organization. The publishing engine only accepts authenticated requests. Adobe's publishing engine isn't something we deploy — it's hosted by Adobe — and they secure access to it via IMS-issued tokens. The OAuth credential is how AEM proves it's calling on behalf of POP.

**Why I/O Management API specifically:** It's the standard scope Adobe requires you to attach to an OAuth Server-to-Server credential. We won't actually use the I/O Management API ourselves — it's just the API binding that makes the credential valid. (Adobe's docs explicitly call this out as the API to add.)

**Why OAuth Server-to-Server and not JWT:** Adobe **deprecated JWT service-account credentials on January 1, 2025**. New setups should use OAuth Server-to-Server. The two paths produce different JSON shapes; we want the OAuth one.

### Exact steps

1. Sign in to https://developer.adobe.com/console with an Adobe ID that has **System Administrator** role on POP's Adobe Admin Console organization
2. Make sure the correct org is selected in the top-right org-switcher (POP's org, not personal)
3. Click **Create new project** → choose **Create empty project**
4. The project appears with a default name (e.g. "Project 1") — rename it to something recognizable, e.g. **`AEM Guides EDS Publishing — Dev`**
5. Inside the project, click **Add API** (or the **+** under "APIs")
6. From the catalog, find and select **I/O Management API**
7. Click **Next**
8. On the "Configure API" screen, when prompted for credential type, select **OAuth Server-to-Server** (not "Service Account (JWT)" — that's the deprecated path)
9. Click **Next**, accept defaults, click **Save configured API**
10. The project's "Credentials" section now shows an **OAuth Server-to-Server** credential. Click it to view details.
11. You'll see the following fields on the credential page:
    - **Client ID**
    - **Client Secrets** (with a "Retrieve client secret" button)
    - **Technical Account ID**
    - **Technical Account Email**
    - **Organization ID** (IMS Org ID, ends in `@AdobeOrg`)
    - **Scopes** (a list)
12. Near the top of the credential page, click the **Download JSON** button. A file downloads, named something like `<project-id>-OAuth Server-to-Server.json`. **This is what we need.**

### What's in the JSON

The downloaded file contains all the values from step 11 in a single JSON object — the OAuth client credentials plus org/IMS metadata. Roughly:

```json
{
  "CLIENT_ID": "abc123...",
  "CLIENT_SECRETS": ["s3cr3t..."],
  "TECHNICAL_ACCOUNT_ID": "...@techacct.adobe.com",
  "TECHNICAL_ACCOUNT_EMAIL": "...",
  "IMS_ORG_ID": "...@AdobeOrg",
  "SCOPES": [ ... ]
}
```

(The exact field names may shift slightly with Developer Console UI updates, but the file is self-contained — AEM just consumes the whole JSON.)

### Deliverable for me

**The downloaded JSON file** (or its full contents pasted into a secure channel — 1Password, encrypted file, etc., **not** in Slack/email plaintext, since it contains the OAuth client secret).

That's everything Track 1 needs.

---

## Track 2 — Cloud Manager env var (I'll handle)

I take the JSON from Track 1, paste its full contents into a new environment variable named `SERVICE_ACCOUNT_DETAILS` on the dev environment (Cloud Manager → Environments → [dev] → Configuration → Add → type: Secret).

## Track 3 — AEM project repo configs (I'll handle)

I add two small OSGi config files to `ui.config/src/main/content/jcr_root/apps/aem-library/osgiconfig/config.author.dev/`:
- One that tells AEM to read `SERVICE_ACCOUNT_DETAILS` from the env var and use it to authenticate to Adobe IMS
- One that flips on microservice publishing and points at the publishing engine URL

Then commit, PR, merge, run the dev pipeline.

*(POP AEM project repo: `~/Documents/Projects/POP-AEM-Sandbox`, `appId=aem-library`.)*

---

## What changes once this is done

- Generate Output in AEM Guides actually works for the EDS preset
- DITA content gets published to the EDS GitHub repo as HTML
- The EDS preview site renders our Guides content
- Frontend POC work (POP branding, custom EDS blocks) becomes unblocked

## What you (PO) need to do

1. **Approve the work** and **route Track 1 to whoever holds Adobe System Administrator** on POP's Adobe Admin Console
2. **Confirm OAuth Server-to-Server is acceptable** (vs. legacy JWT). It's the current Adobe-recommended path; the only reason to choose JWT is if POP's other Adobe integrations require it
3. **Make sure the Dev Console JSON is delivered to me via a secure channel** (1Password vault share, encrypted attachment) — it contains a secret that grants Adobe API access on POP's behalf

## References

All links below are official Adobe documentation.

### The exact walkthrough this work is based on

- **AEM Guides — Configure microservice publishing with OAuth Authentication** *(this is the canonical doc for what we're doing)*
  https://experienceleague.adobe.com/en/docs/experience-manager-guides/using/knowledge-base/kb-articles/publishing/configure-microservices-imt-config

- **AEM Guides — Configure microservice publishing (legacy JWT version)** *(for context only — Adobe deprecated this path Jan 2025)*
  https://experienceleague.adobe.com/en/docs/experience-manager-guides/using/knowledge-base/kb-articles/publishing/configure-microservices

### For the Adobe System Administrator doing Track 1

- **OAuth Server-to-Server credentials — overview**
  https://developer.adobe.com/developer-console/docs/guides/authentication/ServerToServerAuthentication/

- **OAuth Server-to-Server — implementation guide** *(the canonical doc for creating the credential we need)*
  https://developer.adobe.com/developer-console/docs/guides/authentication/ServerToServerAuthentication/implementation

- **Adding an API to a project using OAuth Server-to-Server** *(the exact "add I/O Management API to the project" step)*
  https://developer.adobe.com/developer-console/docs/guides/services/services-add-api-oauth-s2s

- **Adobe HelpX — Migrating to OAuth Server-to-Server credentials** *(plain-English explainer of why JWT is going away and what OAuth S2S looks like)*
  https://helpx.adobe.com/enterprise/kb/migrating-to-oauth-server-to-server-credentials.html

### For context — what the publishing microservice actually is

- **AEM Guides — Cloud Publishing Microservice Architecture and Performance**
  https://experienceleague.adobe.com/en/docs/experience-manager-guides/using/knowledge-base/kb-articles/publishing/publish-microservice-architecture-and-performance

  > "For each publishing request, Experience Manager Guides as a Cloud Service runs a separate container that scales horizontally… Each request is executed in an isolated docker container which runs only one publishing request at a time."
  >
  > Built on Adobe's App Builder + I/O Runtime + IMS. The container has 8 GB of memory, 6 GB allocated to DITA-OT.

- **AEM Guides — Publishing Benchmarks on Cloud**
  https://experienceleague.adobe.com/en/docs/experience-manager-guides/using/knowledge-base/kb-articles/publishing/publishing-benchmarks-on-cloud

### For the developer side (Tracks 2 & 3, my work)

- **Cloud Manager — Environment Variables and Secrets**
  https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/using-cloud-manager/environment-variables

- **AEMaaCS — Configuring OSGi (`$[secret:NAME]` syntax)**
  https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/deploying/configuring-osgi

- **AEMaaCS — Managing secrets tutorial**
  https://experienceleague.adobe.com/en/docs/experience-manager-learn/cloud-service/developing/advanced/secrets
