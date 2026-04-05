---
name: update-skills
description: Check for and apply updates to installed skill branches from upstream.
---

# About

Skills are distributed as git branches (`skill/*`). When you install a skill, you merge its branch into your repo. This skill checks upstream for newer commits on those skill branches and helps you update.

Run `/update-skills` in Claude Code.

## How it works

**Preflight**: checks for clean working tree and upstream remote.

**Detection**: fetches upstream, lists all `upstream/skill/*` branches, determines which ones you've previously merged (via merge-base), and checks if any have new commits.

**Selection**: presents a list of skills with available updates. You pick which to update.

**Update**: merges each selected skill branch, resolves conflicts if any, then validates with build + test.

---

# Goal
Help users update their installed skill branches from upstream without losing local customizations.

# Operating principles
- Never proceed with a dirty working tree.
- Only offer updates for skills the user has already merged (installed).
- Use git-native operations. Do not manually rewrite files except conflict markers.
- Keep token usage low: rely on `git` commands, only open files with actual conflicts.

# Step 0: Preflight

Run:
- `git status --porcelain`

If output is non-empty:
- Tell the user to commit or stash first, then stop.

Check remotes:
- `git remote -v`

If `upstream` is missing:
- Ask the user for the upstream repo URL (default: `https://github.com/sviniabanditka/conclaw.git`).
- `git remote add upstream <url>`

Fetch:
- `git fetch upstream --prune`

# Step 1: Detect installed skills with available updates

List all upstream skill branches:
- `git branch -r --list 'upstream/skill/*'`

For each `upstream/skill/<name>`:
1. Check if the user has merged this skill branch before (compare merge bases)
2. Check if there are new commits: `git log --oneline HEAD..upstream/skill/<name>`

Build three lists:
- **Updates available**: skills that are merged AND have new commits
- **Up to date**: skills that are merged and have no new commits
- **Not installed**: skills that have never been merged

# Step 2: Present results

If no skills have updates available:
- Tell the user all installed skills are up to date.
- Stop here.

If updates are available:
- Show the list with commit counts.
- Use AskUserQuestion with `multiSelect: true` to let the user pick which skills to update.

# Step 3: Apply updates

For each selected skill:
1. `git merge upstream/skill/<name> --no-edit`
2. If conflicts: resolve only conflict markers, preserve customizations, `git add` + `git commit --no-edit`

# Step 4: Validation

After all selected skills are merged:
- `npm run build`
- `npm test`

# Step 5: Summary

Show: skills updated, skills skipped/failed, new HEAD, conflicts resolved.

If the service is running, remind the user to restart it.
