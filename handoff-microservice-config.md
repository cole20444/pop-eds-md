# AEM Guides → EDS POC — Microservice setup record

**Status:** ✅ Completed 2026-05-21. Microservice publishing is live on POP AEMaaCS dev. This doc is kept for the record / future-environment setup reference.

## TL;DR

The Adobe-hosted publishing microservice that converts DITA into the FRANKLIN output for EDS is enabled on POP's AEMaaCS dev environment. Generate Output from AEM Guides now successfully publishes DITA topics to the EDS GitHub repo, and the full pipeline through to aem.live serves real Guides content.

If you need to set this up on a NEW AEMaaCS environment (stage, prod, or a different tenant), the three tracks below are the recipe.

## What was wired up

### Track 1 — Adobe Developer Console (OAuth Server-to-Server credential)

Created in the POP Inc (Technology Partner) Adobe org:
- Project: **EDS Guides**
- Workspace: **Production**
- API: **I/O Management API**
- Credential: **EDS-Github-Crendential** (OAuth Server-to-Server type, not deprecated JWT)
- IMS Org ID: `4A661E516570EABB0A495F88@AdobeOrg`

This credential is what AEM uses to authenticate to Adobe IMS, which in turn authorizes calls to the publishing microservice.

> ⚠️ The associated `client_secret` was inadvertently leaked via IDE selection on 2026-05-20. **Rotation is pending** — Cole needs to add a new client secret in Developer Console, update the Cloud Manager env var, and delete the old secret.

### Track 2 — Cloud Manager environment variables

On the POP AEMaaCS dev environment, in Cloud Manager → Environments → [dev] → Configuration:
- **`SERVICE_ACCOUNT_DETAILS`** (type: Secret) — contents of the OAuth S2S service JSON from Track 1

### Track 3 — OSGi configs in the POP AEM project repo

Committed to `~/Documents/Projects/POP-AEM-Sandbox` (the POP AEM project, `appId=aem-library`, `groupId=com.wearepop`):

`ui.config/src/main/content/jcr_root/apps/aem-library/osgiconfig/config.author.dev/`
├── `com.adobe.aem.guides.eventing.ImsConfiguratorService.cfg.json`
└── `com.adobe.fmdita.publishworkflow.PublishWorkflowConfigurationService.cfg.json`

Both file contents:

`com.adobe.aem.guides.eventing.ImsConfiguratorService.cfg.json`
```json
{
  "service.account.details": "$[secret:SERVICE_ACCOUNT_DETAILS]"
}
```

`com.adobe.fmdita.publishworkflow.PublishWorkflowConfigurationService.cfg.json`
```json
{
  "dxml.publish.microservice.url": "https://adobeioruntime.net/api/v1/web/543112-guidespublisher/default/publishercaller.json",
  "dxml.use.publish.microservice": true,
  "dxml.use.publish.microservice.native.pdf": true
}
```

Deployed via Cloud Manager pipeline (dev). After deployment, Generate Output on the AEM Guides side now succeeds.

## How the pieces connect

```
┌──────────────────────────────┐     ┌──────────────────────┐     ┌──────────────────────────┐
│ Adobe Developer Console      │     │ Cloud Manager        │     │ AEM Project Repo         │
│ (Adobe System Administrator) │ ──▶ │ (Cloud Manager admin)│ ──▶ │ (Developer)              │
│                              │     │                      │     │                          │
│ EDS Guides project           │     │ SERVICE_ACCOUNT_     │     │ Two OSGi configs in      │
│ → I/O Management API         │     │ DETAILS env var      │     │ ui.config/.../config.    │
│ → OAuth S2S credential       │     │ holds the JSON.      │     │ author.dev/              │
│ → service JSON               │     │                      │     │                          │
└──────────────────────────────┘     └──────────────────────┘     └──────────────────────────┘
                                                                              │
                                                                              ▼
                                                              ┌──────────────────────────────┐
                                                              │ At runtime, AEM:             │
                                                              │  1. Reads SERVICE_ACCOUNT_   │
                                                              │     DETAILS                  │
                                                              │  2. Authenticates to Adobe   │
                                                              │     IMS with client creds    │
                                                              │  3. Gets an access token     │
                                                              │  4. Calls the publishing     │
                                                              │     microservice (Adobe-     │
                                                              │     hosted, container-based  │
                                                              │     DITA-OT)                 │
                                                              │  5. Microservice publishes   │
                                                              │     to GitHub via Push to    │
                                                              │     live → GitHub Pages →    │
                                                              │     aem.live serves it.      │
                                                              └──────────────────────────────┘
```

## To repeat this for a new environment

If you stand up a new AEMaaCS environment (e.g., stage or prod), the three tracks need to happen there too:

1. **Track 1** — reuse the SAME Developer Console project (it's org-level, not env-level) → just keep the credential
2. **Track 2** — set `SERVICE_ACCOUNT_DETAILS` env var on the new CM environment with the same JSON
3. **Track 3** — copy the OSGi configs to a `config.author.<runmode>` folder matching the new env (e.g., `config.author.stage`, `config.author.prod`). Deploy via CM pipeline targeting that env.

## References

- Adobe canonical setup walkthrough (OAuth S2S): https://experienceleague.adobe.com/en/docs/experience-manager-guides/using/knowledge-base/kb-articles/publishing/configure-microservices-imt-config
- Microservice architecture overview: https://experienceleague.adobe.com/en/docs/experience-manager-guides/using/knowledge-base/kb-articles/publishing/publish-microservice-architecture-and-performance
- OAuth Server-to-Server overview: https://developer.adobe.com/developer-console/docs/guides/authentication/ServerToServerAuthentication/
- Cloud Manager Environment Variables: https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/using-cloud-manager/environment-variables
- AEMaaCS — Configuring OSGi (`$[secret:NAME]` syntax): https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/deploying/configuring-osgi
