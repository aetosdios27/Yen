#!/usr/bin/env bash
# Idempotently applies the repository settings and rulesets that enforce our PR-only workflow.
# Needs: gh (authenticated as a repo admin), jq.
# Usage: .github/scripts/apply-repo-settings.sh [owner/repo]
set -euo pipefail

repo="${1:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../rulesets" && pwd)"

echo "==> Repository settings for $repo"
gh api -X PATCH "repos/$repo" \
  -F allow_squash_merge=true \
  -F allow_merge_commit=false \
  -F allow_rebase_merge=false \
  -f squash_merge_commit_title=PR_TITLE \
  -f squash_merge_commit_message=PR_BODY \
  -F delete_branch_on_merge=true \
  -F allow_auto_merge=true \
  -F allow_update_branch=true \
  -F has_wiki=false \
  -F has_projects=false \
  -f 'security_and_analysis[secret_scanning][status]=enabled' \
  -f 'security_and_analysis[secret_scanning_push_protection][status]=enabled' \
  --silent

echo "==> Dependabot alerts and security updates"
gh api -X PUT "repos/$repo/vulnerability-alerts" --silent || echo "warn: could not enable vulnerability alerts"
gh api -X PUT "repos/$repo/automated-security-fixes" --silent || echo "warn: could not enable security updates"

echo "==> Private vulnerability reporting"
gh api -X PUT "repos/$repo/private-vulnerability-reporting" --silent || echo "warn: could not enable private vulnerability reporting"

echo "==> Actions: read-only token, approval for outside contributors"
gh api -X PUT "repos/$repo/actions/permissions/workflow" \
  -f default_workflow_permissions=read \
  -F can_approve_pull_request_reviews=false --silent
gh api -X PUT "repos/$repo/actions/permissions/fork-pr-contributor-approval" \
  -f approval_policy=all_external_contributors --silent \
  || echo "warn: could not set fork PR approval policy"

echo "==> Actions: allow-list and enforced SHA pinning"
gh api -X PUT "repos/$repo/actions/permissions" \
  -F enabled=true -f allowed_actions=selected -F sha_pinning_required=true --silent
gh api -X PUT "repos/$repo/actions/permissions/selected-actions" \
  -F github_owned_allowed=true -F verified_allowed=false \
  -f 'patterns_allowed[]=gitleaks/gitleaks-action@*' \
  -f 'patterns_allowed[]=pnpm/action-setup@*' \
  -f 'patterns_allowed[]=amannn/action-semantic-pull-request@*' --silent

echo "==> Immutable releases"
gh api -X PUT "repos/$repo/immutable-releases" --silent || echo "warn: could not enable immutable releases"

echo "==> Secret scanning extras (may need a paid tier; best effort)"
gh api -X PATCH "repos/$repo" \
  -f 'security_and_analysis[secret_scanning_non_provider_patterns][status]=enabled' \
  -f 'security_and_analysis[secret_scanning_validity_checks][status]=enabled' --silent \
  || echo "warn: could not enable secret scanning extras"

echo "==> Rulesets"
for file in "$dir"/*.json; do
  name="$(jq -r .name "$file")"
  id="$(gh api "repos/$repo/rulesets" --jq ".[] | select(.name == \"$name\") | .id")"
  if [ -n "$id" ]; then
    gh api -X PUT "repos/$repo/rulesets/$id" --input "$file" --silent
    echo "updated: $name"
  else
    gh api -X POST "repos/$repo/rulesets" --input "$file" --silent
    echo "created: $name"
  fi
done
echo "Done."
