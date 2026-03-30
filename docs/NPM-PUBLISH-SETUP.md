# npm Publish Setup

This is a one-time setup guide. Once configured, publishing a new version is just: bump the version, push a tag, approve the deploy.

---

## What You Need from Your npm Administrator

Your npm administrator manages the `@ultracart` npm organization. You need **one thing** from them:

### An npm Automation Token

Ask your npm administrator to generate a token (or do it together):

1. Go to https://www.npmjs.com/ and log in with the UltraCart npm account
2. Click the profile icon (top right) -> **Access Tokens**
3. Click **Generate New Token**
4. Select **Granular Access Token** (not Classic — granular is more secure)
5. Configure it:
   - **Token name:** `github-actions-bq-skill` (so you know what it's for)
   - **Expiration:** pick a reasonable window (e.g., 1 year) — you'll need to rotate it when it expires
   - **Packages and scopes:** select **Only select packages and scopes**, then choose `@ultracart`
   - **Permissions:** **Read and write**
   - **Organizations:** no access needed
6. Click **Generate Token**
7. **Copy the token immediately** — npm only shows it once

The token looks like: `npm_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345678`

**Security:** This token can publish packages to the `@ultracart` npm scope. Treat it like a password. Never put it in code, chat, email, or anywhere other than GitHub Secrets.

---

## What You Do in GitHub

### Step 1: Add the npm Token as a GitHub Secret

1. Go to your repo on GitHub: `https://github.com/UltraCart/uc-bq-claude-skill`
2. Click **Settings** (tab at the top of the repo)
3. In the left sidebar: **Secrets and variables** -> **Actions**
4. Click **New repository secret**
5. **Name:** `NPM_TOKEN`
6. **Secret:** paste the token the npm administrator gave you
7. Click **Add secret**

That's it. The token is now encrypted and only accessible to GitHub Actions workflows. Nobody can read it back — not you, not the npm administrator, not anyone viewing the repo.

### Step 2: Create a Protected Environment

This adds an approval gate so nobody can publish without a human clicking "approve."

1. Still in repo **Settings**
2. In the left sidebar: **Environments**
3. Click **New environment**
4. **Name:** `npm`
5. Click **Configure environment**
6. Under **Environment protection rules**, check **Required reviewers**
7. Add yourself (and/or the npm administrator) as a required reviewer
8. Click **Save protection rules**

Now when the publish workflow runs, it will pause and wait for you (or the npm administrator) to approve before actually publishing to npm.

### Step 3: Verify the Workflow File Exists

The workflow is already in the repo at `.github/workflows/publish.yml`. You don't need to create or edit it — it was committed with this setup guide.

---

## How to Publish a New Version

Once the above setup is done, here's the process every time you want to release:

### 1. Bump the version in package.json

```bash
# For a patch release (0.1.0 -> 0.1.1):
npm version patch

# For a minor release (0.1.0 -> 0.2.0):
npm version minor

# For a major release (0.1.0 -> 1.0.0):
npm version major
```

`npm version` does three things automatically: updates `package.json`, creates a git commit, and creates a git tag.

### 2. Push the commit and tag

```bash
git push && git push --tags
```

### 3. Approve the deploy

1. Go to the repo on GitHub
2. Click the **Actions** tab
3. You'll see a workflow run waiting for approval
4. Click into it, review, and click **Approve and deploy**

### 4. Verify

```bash
npm info @ultracart/bq-skill
```

You should see the new version listed.

---

## What the Workflow Does

When you push a tag like `v0.1.0`, the GitHub Actions workflow:

1. **Checks out** the exact tagged commit
2. **Installs** dependencies from the lockfile
3. **Builds** TypeScript to JavaScript (`npm run build`)
4. **Verifies** the tag version matches `package.json` (so you can't accidentally publish a mismatch)
5. **Waits for approval** (the protected environment gate)
6. **Publishes** to npm with provenance attestation

The provenance attestation is a cryptographic proof that this specific package was built from this specific commit in this specific repo. Anyone can verify it. It's npm's way of preventing supply chain attacks.

---

## Security Checklist

- [ ] npm token is stored ONLY in GitHub Secrets (never in code, `.env`, or chat)
- [ ] npm token is a granular token scoped to `@ultracart` only (not a full-access classic token)
- [ ] GitHub environment `npm` has required reviewers enabled
- [ ] The workflow only triggers on `v*` tags (not on PRs from forks)
- [ ] All GitHub Actions are pinned to commit SHAs (not mutable version tags)
- [ ] npm provenance is enabled (`--provenance` flag)
- [ ] Workflow permissions are minimal (`contents: read`, `id-token: write`)

---

## Rotating the npm Token

When the token expires (or if it's ever compromised):

1. The npm administrator generates a new token on npmjs.com (same steps as above)
2. Go to GitHub repo **Settings** -> **Secrets and variables** -> **Actions**
3. Click the pencil icon next to `NPM_TOKEN`
4. Paste the new token
5. Click **Update secret**

The old token is immediately revoked when the npm administrator generates a new one. No code changes needed.

---

## Troubleshooting

**"npm ERR! 403 Forbidden"**
- The npm token is wrong, expired, or doesn't have publish permissions for `@ultracart`
- Ask the npm administrator to check the token on npmjs.com

**"Tag version does not match package.json version"**
- You pushed a tag like `v0.2.0` but `package.json` still says `0.1.0`
- Use `npm version` to bump — it keeps them in sync automatically

**"Waiting for approval" and nothing happens**
- Someone in the required reviewers list needs to approve the deploy in the Actions tab
- Check that you added yourself as a reviewer in the `npm` environment settings

**Workflow doesn't run at all**
- Make sure you pushed the tag: `git push --tags`
- Make sure the tag starts with `v`: `v0.1.0`, not `0.1.0`
