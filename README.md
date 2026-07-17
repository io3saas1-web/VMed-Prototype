# VMed Netlify Deployment

This package replaces the local `femet_proxy.js` and Command Prompt window
with a Netlify serverless function.

## Folder structure

```text
VMed_Netlify_Deployment/
├── index.html
├── netlify.toml
└── netlify/
    └── functions/
        └── femet-vitals.mjs
```

## Recommended deployment method

Use a GitHub repository connected to Netlify. This lets Netlify build and
deploy the serverless function together with the static HTML.

## Required Netlify environment variables

Set these in the Netlify project UI:

- `FEMET_ACCOUNT`
- `FEMET_PASSWORD`

Optional:

- `FEMET_BASE_URL`
  - Defaults to `https://rd-io3.femetmed.com/api-rtwatchm`
- `VITALS_ALLOWED_EMAILS`
  - Comma-separated Firebase emails allowed to read vitals.
  - Default: `admin@io3demo.com,clinician@io3demo.com`
- `FIREBASE_WEB_API_KEY`
  - The Firebase Web API key. A default is already included for this prototype.

After adding or changing environment variables, trigger a new deployment.

## Expected user experience after deployment

The shore user only needs to:

1. Open the Netlify HTTPS URL.
2. Sign in with the Firebase account.
3. Enter the Daily meeting display name.
4. Join the meeting.
5. Select one of the five demo patients.

They do not need Node.js, Command Prompt, or `femet_proxy.js`.

## Prototype limitations

- The function only permits `VMedDemoGroup` and `CARD-001` to `CARD-005`.
- Only the configured admin/clinician Firebase emails can call the vitals function.
- This remains an internal proof of concept, not a production medical-data architecture.
- Rotate the FEMET sandbox password if it was previously placed in an HTML file or screenshot.
