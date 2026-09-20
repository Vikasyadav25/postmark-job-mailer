# Postmark — your personal application workspace

A mobile-friendly, Google-authenticated, multi-user web app for sending reviewed job application emails from each user's own Gmail account. You and your girlfriend use the same link with separate accounts. Plain HTML, CSS, and JavaScript on Google Apps Script; no runtime packages, paid server, database subscription, AI API, Gmail password, or app password.

## What works

- Paste **one recruiter email**, optionally add company and role, and personalize a saved template.
- Edit the subject and message before opening a final review.
- Upload one **PDF resume up to 5 MB**, stored as a private, app-created Google Drive file. It works across devices and is attached automatically.
- Press **Send email** to send that exact reviewed message through Gmail. Successful sends appear in Gmail Sent.
- See the latest 10 attempts from 7 days of app activity. This is a submission log, not delivery or read tracking.
- Separate account storage, server-side identity checks, short-lived review snapshots, resume integrity checks, durable duplicate protection, and a per-user cap of 25 attempts per rolling 24 hours.

Job description parsing, AI customization, bulk sending, scheduling and tracking pixels are outside this MVP. The draft you are editing is not saved across reloads; each user's template and resume are saved.

## Files

| File                    | Purpose                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| `Code.gs`               | Per-user authorization and storage, review snapshots, MIME email, sending, history and legacy data migration |
| `Index.html`            | Accessible compose, settings, activity and final review interface                                            |
| `Styles.html`           | Responsive styles; system fonts and no external assets                                                       |
| `Client.html`           | UI state and Google Apps Script RPC calls                                                                    |
| `appsscript.json`       | Explicit permissions, Gmail and Drive services, authenticated multi-user deployment                          |
| `scripts/`              | Local UI preview with in-memory sample data; cannot send mail                                                |
| `tests/server.test.mjs` | Offline server tests with mocked Google services                                                             |

The HTML fragments include their `<style>` / `<script>` tags because Apps Script serves HTML files. They are separated for maintainability.

## Deploy once, use with separate Google accounts

One person hosts the project. You and your girlfriend open the **same link**, sign in with your own Google accounts, and each grant permission. Each user needs a working Gmail mailbox. Google handles sign-in before the app opens; there is no separate app password or custom login form.

Initial setup is easiest on a computer. For a small trusted group, this design needs no paid server, paid Workspace subscription, custom domain or billing account. Google quotas, account restrictions, available Drive storage and OAuth authorization limits still apply. A broad public launch has extra requirements described below.

1. Create a standalone project at [script.google.com](https://script.google.com/) and name it `Postmark`.
2. Replace the default `Code.gs` with this project's **full `Code.gs`**.
3. Add three HTML files named **Index**, **Styles**, and **Client**, and paste the contents of their matching local `.html` files. Do not copy `scripts/preview-demo.js` into Apps Script.
4. Open **Project Settings**, enable **Show "appsscript.json" manifest file in editor**, and replace that manifest with this project's `appsscript.json`. Save. The editor's **Services** list should show Gmail API v1 and Drive API v3. The manifest enables these services for the default Apps Script Cloud project. If using a separately managed standard Cloud project, also enable Gmail API and Google Drive API in that project's Cloud console.
5. Click **Deploy → New deployment → Web app**. Set **Execute as: User accessing the web app** and **Who has access: Anyone with Google account**. These are essential: **do not use Execute as Me**. The manifest encodes them as `USER_ACCESSING` and `ANYONE`; `ANYONE` here requires Google sign-in, not anonymous access. Running `setup` in the editor is optional; it no longer registers a single owner.
6. Open the resulting **`/exec`** URL. Google asks you to sign in and authorize the app. Grant the listed permissions so sending and resume storage can work. No email sends during authorization. In Settings, save your name/template and upload your PDF. The signed-in email shown there is the sender; it is not a manually editable From address.
7. Share the **`/exec` link**, not editor access, with your girlfriend. She opens it in her own browser session, authorizes with her Google account, and saves her own template and resume. She does not create or deploy a separate project. Each resume copy is created in its user's Drive; replacing it moves only that user's previous app-created copy to trash.
8. Each of you should test with **your own email as the recipient**. Review, press Send, and check Gmail Sent and the received attachment. Confirm that her account starts with no copy of your data and vice versa.
9. Open the same `/exec` URL in Safari on iPhone. Bookmark it; optionally use **Share → Add to Home Screen**. This remains an online web app: Google sign-in and a working connection are required. It is not an offline PWA.

The template, resume reference, history, review cache, send lock and 25-attempt allowance are scoped to each signed-in user. Gmail sends under that user's authorized identity. No user email, sender override or resume file ID supplied by the browser selects another user's account.

### Two trusted users versus a public launch

For you and your girlfriend, an unverified Apps Script OAuth consent screen may appear. Review the app identity and permissions, and proceed only if you trust the project maintainer. Unverified apps have a Google-imposed user cap; this is not an unlimited public launch. Workspace administrators can also block authorization or external access.

For public distribution without the unverified warning and user cap, complete **Google OAuth client verification**. This requires a standard Google Cloud project, an appropriate external audience, a verified domain with app information and a privacy policy, and Google's review of the requested scopes. If you configure OAuth in **Testing** mode, add both Google addresses as test users; only approved test users can authorize. Publishing the consent screen alone does not complete verification. See [Google's Apps Script OAuth verification guidance](https://developers.google.com/apps-script/guides/client-verification).

If the deployment selector only allows your Workspace organization, its policies may prevent external users. Use a permitted hosting account or work with the administrator; application code cannot bypass that restriction.

### Updating the previous single-owner version

Deploy this code **and** the new execution/access settings together. For the first multi-user upgrade, create a new deployment and share its new URL. Retire the previous deployment to avoid running both data models. Do not simply expose the old single-owner deployment to more people.

The previous owner's template, resume reference and activity migrate into that owner's User Properties on their first load, then the legacy shared properties are removed. Other users cannot trigger that owner's migration or see the legacy data. Existing newer user settings are preserved. Old in-progress reviews are not migrated; review again before sending. Let any in-flight old send finish before upgrading.

For subsequent changes, use **Deploy → Manage deployments → Edit → New version → Deploy**. Saving editor code alone does not update a versioned deployment.

With multiple Google accounts, use a browser profile/session signed into the intended account and check the sender in Settings. Google sign-in belongs to the browser session; the app does not sign you out of other Google services. If a cached page belongs to a different account, reload and review again. Never fix an account mismatch by deploying as the developer.

## Permissions and data

| Scope                     | Why it is needed                                                               |
| ------------------------- | ------------------------------------------------------------------------------ |
| `userinfo.email`          | Verify that execution uses the signed-in visitor's own identity                |
| `gmail.send`              | Send your reviewed message; does not grant inbox-reading access                |
| `drive.file`              | Create and access only files used with this app, including the uploaded resume |
| `script.external_request` | Fetch the saved resume bytes from the Google Drive API on the server           |

OAuth tokens stay on Google's server and are never returned to the browser. Your browser uses `google.script.run`; no custom public mail endpoint or client-side credential exists. Every public application RPC checks that the signed-in and executing identities match. Private helpers use Apps Script's trailing-underscore convention. Do not share editor access to this project or share app-created resume files publicly.

The template and resume metadata live in per-user User Properties. Your PDF lives in your Drive. Reviewed message text is stored in a user-scoped server cache for up to 10 minutes and may expire sooner under cache eviction. Editing the email requires another review. A send checks the snapshot's sender, verifies that the saved resume has not changed, and validates the downloaded PDF checksum. Gmail receives a plain-text MIME message with the actual PDF attachment.

Recipient, subject, attempt time and submission outcome are retained in that user's User Properties for 7 days; expired entries are removed when that user next loads the app or sends. Only 10 recent attempts are displayed. Bodies and resume bytes are not stored in the activity log. No application logging of message bodies or credentials is added. Google's platform execution metadata and ordinary Gmail/Drive retention are separate from this app's data.

To remove a resume, use **Remove saved resume** in Settings and empty its Drive trash item if desired. Revoke the app in your Google Account's connected-app settings to stop future access; revocation does not itself erase settings, Drive files or Gmail messages. The project owner can delete the whole project to remove its app storage for everyone; this does not delete users' Drive files or sent mail. Account separation protects users from each other through the app; it is not end-to-end encryption against the project maintainer. Only use a deployment whose maintainer you trust.

## Sending behavior and limitations

- Opening the app, editing, saving settings, uploading a resume, and opening review **never send mail**.
- Each review gets an opaque ID and a frozen server-side snapshot. Send accepts that ID rather than trusting replacement message contents from the browser.
- The per-user send lock and durable attempt record prevent repeated calls for the same review from submitting again, even if the client loses the response. Reviews expire after 10 minutes; attempt records outlive them by days.
- A timeout can occur after Gmail accepted a message. The app reports an **uncertain outcome**, blocks automatic resubmission, and asks you to check Gmail Sent. With send-only access it cannot inspect Sent for you. Do not create a second application for that message until you have checked.
- Gmail confirmation means **accepted for sending**, not delivered, read, or guaranteed free of spam filtering. Rejections, bounces, suspended accounts and Google limits can still occur.
- The app's cap of **25 attempts per user per rolling 24 hours** is a conservative product limit, not a promise about Gmail's quota. Uncertain attempts count toward it. Google limits may be lower or change independently.
- PDF is the only supported resume format. Use an unencrypted, readable resume. Uploading validates its size and PDF signature; it is not a malware scan or a full PDF parser.
- No automatic retries, multi-recipient mail, CC/BCC, arbitrary sender addresses, scraping, or background sends.

## Preview and test locally

### GitHub storage and hosting

Use a GitHub repository to store and version this source code. Uploading it to GitHub does **not** deploy the working app. GitHub Pages serves static files and cannot run `Code.gs` or the Apps Script `google.script.run` backend. This project's HTML also contains Apps Script includes, so publishing the raw files as Pages is not a working deployment.

Deploy the complete app through **Google Apps Script** using the instructions above, then share its `/exec` URL. GitHub Pages could host a separately assembled frontend demo, but Google login, saved resumes and Gmail sending in this implementation run on Apps Script. See [GitHub Pages hosting capabilities](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

Commit only the app source, tests and documentation. Personal PDF files, local credentials, environment files and generated screenshots are excluded by `.gitignore`.

### Local preview

Node.js 20+ is sufficient. No install step or runtime dependencies:

```powershell
npm test
npm run preview
```

Open **http://127.0.0.1:4173**. This preview explicitly uses sample account details and in-memory settings. It can demonstrate compose, edit, review, settings and upload UI, but **cannot send mail or save to Google Drive**. Reloading resets sample data. The local server only serves the assembled preview page; it does not expose other workspace files.

The offline tests verify multi-user data and draft isolation, correct sender identity, independent quotas and locks, legacy-owner migration, authorization, validation, MIME attachment encoding, snapshot immutability, changed-resume rejection, expired reviews, repeat-send protection, and uncertain send outcomes. They do not prove live Google authorization, deployed Safari behavior or delivery. Complete a self-send test with each account after deployment.

## Why this hosting choice

Google Apps Script supplies hosting and Google authorization, and runs each request under the visiting user's account. This avoids a separate OAuth backend and hosting subscription for a small shared app. The tradeoffs are Google's authorization/deployment flow, online-only usage, quotas and OAuth verification for public distribution. No external email service is used.

Official references: [Apps Script web apps](https://developers.google.com/apps-script/guides/web), [advanced services setup](https://developers.google.com/apps-script/guides/services/advanced), [Gmail sending](https://developers.google.com/workspace/gmail/api/guides/sending), [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [Drive file access](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), and [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas).
