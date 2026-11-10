#!/usr/bin/env bash
# Deploy and rollback mechanics for the Yen API container.
#
# The GitHub Actions workflow .github/workflows/deploy.yml calls this script
# for every infrastructure step. Cloud authentication is OpenID Connect only:
# the runner exchanges a short-lived GitHub OIDC token for temporary cloud
# credentials, so no long-lived credentials live in GitHub Secrets.
#
# Subcommands:
#   image <git-sha>                build and push the API image, print its digest
#   migrate <env> <image-digest>   run database migrations as a one-off task
#   deploy <env> <image-digest>    register a task revision and roll containers
#   smoke <base-url> <git-sha>     post-deployment probes
#   rollback <env> [revision]      route traffic to an earlier task revision
#   selftest                       offline tests, including the migration
#                                  failure negative test
#
# Environment variables:
#   DRY_RUN=1                       print infrastructure commands instead of
#                                   running them
#   FAILPOINT=migrate               force the migration step to fail (selftest)
#   OIDC_ROLE_ARN                   cloud role assumed through OIDC
#   AWS_REGION                      cloud region
#   ECR_REPOSITORY                  ECR repository name for the API image
#   ECS_CLUSTER                     ECS cluster for the active environment
#   ECS_SERVICE                     ECS service for the active environment
#   ECS_CONTAINER_NAME              container name inside the task definition
#   ECS_MIGRATION_TASK_DEFINITION   task definition family for migration tasks
#   ECS_SUBNETS                     comma separated subnet ids
#   ECS_SECURITY_GROUPS             comma separated security group ids
#   MIGRATION_SECRET_ID             Secrets Manager id holding the migration
#                                   DATABASE_URL; read at deploy time only and
#                                   never stored in GitHub

set -euo pipefail

log() {
  printf '%s\n' "$*"
}

fail() {
  printf 'deploy-api: %s\n' "$*" >&2
  exit 1
}

usage() {
  sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

# Runs a command, or prints it when DRY_RUN is set. Value-producing
# infrastructure calls go through run_capture, which returns a fixed mock in
# dry run mode so a dry run still prints a complete, realistic plan.
run() {
  if [[ -n "${DRY_RUN:-}" ]]; then
    log "[dry-run] $*"
  else
    "$@"
  fi
}

run_capture() {
  if [[ -n "${DRY_RUN:-}" ]]; then
    log "[dry-run] $*"
    case "$1 $2" in
      "aws sts get-caller-identity")
        printf '%s\n' "${DRY_ACCOUNT_ID:-000000000000}"
        ;;
      "aws ecs describe-services")
        printf '%s\n' "${DRY_CURRENT_TASK_DEFINITION:-arn:aws:ecs:mock:000000000000:task-definition/yen-api:42}"
        ;;
      "aws ecs describe-task-definition")
        printf '%s\n' '{"containerDefinitions":[{"name":"api","image":"mock"}]}'
        ;;
      *)
        printf '%s\n' ""
        ;;
    esac
    return 0
  fi
  "$@"
}

require_vars() {
  local missing=()
  local name
  for name in "$@"; do
    [[ -n "${!name:-}" ]] || missing+=("$name")
  done
  if ((${#missing[@]} > 0)); then
    fail "missing required variables: ${missing[*]}"
  fi
}

# Exchanges the GitHub Actions OIDC token for temporary cloud credentials.
# Requires id-token: write on the calling workflow job; the token endpoint
# variables are provided by the runner.
assume_role() {
  local session=$1
  if [[ -n "${DRY_RUN:-}" ]]; then
    log "[dry-run] aws sts assume-role-with-web-identity --role-arn ${OIDC_ROLE_ARN:-unset} --role-session-name yen-api-$session"
    return 0
  fi
  require_vars OIDC_ROLE_ARN ACTIONS_ID_TOKEN_REQUEST_TOKEN ACTIONS_ID_TOKEN_REQUEST_URL
  local token
  token="$(curl --fail --silent --show-error \
    --header "Authorization: Bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}" \
    "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=sts.amazonaws.com" | jq -e -r '.value')" \
    || fail "could not fetch a GitHub OIDC token"
  local creds
  creds="$(aws sts assume-role-with-web-identity \
    --role-arn "$OIDC_ROLE_ARN" \
    --role-session-name "yen-api-$session" \
    --web-identity-token "$token" \
    --duration-seconds 900 \
    --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' \
    --output text)" || fail "OIDC role assumption failed for $OIDC_ROLE_ARN"
  local key secret session_token
  read -r key secret session_token <<<"$creds"
  export AWS_ACCESS_KEY_ID="$key"
  export AWS_SECRET_ACCESS_KEY="$secret"
  export AWS_SESSION_TOKEN="$session_token"
}

main() {
  local cmd=${1:-}
  [[ -n "$cmd" ]] || { usage; exit 1; }
  shift
  case "$cmd" in
    image) image "$@" ;;
    migrate) migrate "$@" ;;
    deploy) deploy "$@" ;;
    smoke) smoke "$@" ;;
    rollback) rollback "$@" ;;
    selftest) selftest ;;
    -h | --help | help) usage ;;
    *)
      usage >&2
      fail "unknown subcommand: $cmd"
      ;;
  esac
}

main "$@"
